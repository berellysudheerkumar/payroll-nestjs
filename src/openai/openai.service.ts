import {Injectable, InternalServerErrorException} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import OpenAI from 'openai';
import {PrismaService} from '../prisma/prisma.service';

@Injectable()
export class OpenaiService {
  private readonly client: OpenAI;
  public readonly defaultModel: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    this.client = new OpenAI({apiKey});
    this.defaultModel = this.configService.get<string>('OPENAI_MODEL', 'gpt-4o');
  }

  async processNaturalLanguageQuery(userQuery: string, user: any): Promise<string> {
    const orgId = user.organizationId;
    const isEmployee = user.roles?.some((r: any) => r === 'EMPLOYEE');
    const isAdmin = user.roles?.some((r: any) =>
      ['SUPER_ADMIN', 'ORGANIZATION_ADMIN', 'HR_ADMIN'].includes(r),
    );
    const employeeRecord = await this.prisma.employee.findFirst({
      where: {email: user.email, organizationId: orgId},
    });

    const systemPrompt = `You are an expert HR and Payroll AI Assistant for PayrollPro.
You are currently talking to: ${user.firstName} ${user.lastName} (${user.email}).
User Role: ${isAdmin ? 'Admin/HR' : 'Employee'}.
Organization ID: ${orgId}.
${isEmployee && employeeRecord ? `Employee ID: ${employeeRecord.id}` : ''}

CRITICAL RULES:
1. If the user is an 'Employee', ONLY provide information about their own data. Do not disclose other employees' salaries or organization-wide totals.
2. If the user is an 'Admin/HR', you can provide organization-wide data (dashboard stats, list of employees, etc.).
3. Use the provided tools to fetch real-time data from the database. NEVER guess numbers.
4. If an employee asks "why did my salary change" or similar, use 'get_employee_payslips' to compare their recent payslips.
5. Provide clear, concise, and professional answers. Use markdown for tables or lists if helpful.`;

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      {role: 'system', content: systemPrompt},
      {role: 'user', content: userQuery},
    ];

    const tools: OpenAI.Chat.ChatCompletionTool[] = [
      {
        type: 'function',
        function: {
          name: 'get_dashboard_stats',
          description:
            'Gets overview dashboard stats (total employees, recent payroll runs, pending approvals) for the organization. Admin only.',
          parameters: {type: 'object', properties: {}},
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_employees_list',
          description: 'Gets a list of employees in the organization. Admin only.',
          parameters: {
            type: 'object',
            properties: {
              departmentId: {type: 'string', description: 'Optional department ID filter'},
            },
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_employee_details',
          description:
            'Gets details about a specific employee, including their base salary structure.',
          parameters: {
            type: 'object',
            properties: {
              employeeId: {type: 'string', description: 'The ID of the employee.'},
            },
            required: ['employeeId'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_employee_payslips',
          description:
            'Gets the historical payslips/payroll items for a specific employee, including earnings and deductions breakdown. Use this to compare month-over-month salary changes.',
          parameters: {
            type: 'object',
            properties: {
              employeeId: {type: 'string', description: 'The ID of the employee.'},
              limit: {
                type: 'number',
                description: 'Number of recent payslips to fetch (default 3).',
              },
            },
            required: ['employeeId'],
          },
        },
      },
    ];

    try {
      const response = await this.client.chat.completions.create({
        model: this.defaultModel,
        messages: messages,
        tools: tools,
        tool_choice: 'auto',
      });

      const responseMessage = response.choices[0].message;

      if (!responseMessage.tool_calls || responseMessage.tool_calls.length === 0) {
        return responseMessage.content || 'I could not generate an answer.';
      }

      messages.push(responseMessage);

      // Execute Tool Calls
      for (const toolCall of responseMessage.tool_calls) {
        if (toolCall.type === 'function') {
          const fnName = toolCall.function.name;
          let args: any = {};
          try {
            args = JSON.parse(toolCall.function.arguments);
          } catch (e) {}

          let result: any = null;

          try {
            if (fnName === 'get_dashboard_stats') {
              if (!isAdmin) throw new Error('Unauthorized');
              const totalEmployees = await this.prisma.employee.count({
                where: {organizationId: orgId},
              });
              const recentRuns = await this.prisma.payrollRun.findMany({
                where: {organizationId: orgId},
                orderBy: {createdAt: 'desc'},
                take: 5,
                include: {payrollPeriod: true},
              });
              result = {totalEmployees, recentRuns};
            } else if (fnName === 'get_employees_list') {
              if (!isAdmin) throw new Error('Unauthorized');
              result = await this.prisma.employee.findMany({
                where: {
                  organizationId: orgId,
                  ...(args.departmentId && {departmentId: args.departmentId}),
                },
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  department: {select: {name: true}},
                },
              });
            } else if (fnName === 'get_employee_details') {
              // Ensure employees can only view themselves
              if (!isAdmin && employeeRecord?.id !== args.employeeId)
                throw new Error('Unauthorized to view other employees');

              result = await this.prisma.employee.findUnique({
                where: {id: args.employeeId, organizationId: orgId},
                include: {department: true, salaryStructures: {include: {components: true}}},
              });
            } else if (fnName === 'get_employee_payslips') {
              if (!isAdmin && employeeRecord?.id !== args.employeeId)
                throw new Error('Unauthorized to view other employees');

              result = await this.prisma.payrollItem.findMany({
                where: {employeeId: args.employeeId, payrollRun: {organizationId: orgId}},
                orderBy: {payrollRun: {createdAt: 'desc'}},
                take: args.limit || 3,
                include: {
                  payrollRun: {include: {payrollPeriod: true}},
                  components: true,
                },
              });
            } else {
              result = {error: 'Unknown function call'};
            }
          } catch (e: any) {
            result = {error: e.message};
          }

          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(result),
          });
        }
      }

      // Final summarization pass
      const finalResponse = await this.client.chat.completions.create({
        model: this.defaultModel,
        messages: messages,
      });

      return finalResponse.choices[0].message.content || 'Data retrieved, but summary failed.';
    } catch (error) {
      console.error('OpenAI Error:', error);
      throw new InternalServerErrorException('Failed to process AI query');
    }
  }
}
