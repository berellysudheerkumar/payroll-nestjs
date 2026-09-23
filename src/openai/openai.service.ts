// src/openai/openai.service.ts
import {Injectable, InternalServerErrorException} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import OpenAI from 'openai';

@Injectable()
export class OpenaiService {
  private readonly client: OpenAI;
  public readonly defaultModel: string;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    this.client = new OpenAI({apiKey});
    this.defaultModel = this.configService.get<string>('OPENAI_MODEL', 'gpt-4o');
  }

  async processNaturalLanguageQuery(
    userQuery: string,
    organizationId: string,
    fetchDataCallback: (orgId: string, args: any) => Promise<any>,
  ): Promise<string> {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: `You are an expert HR and Payroll assistant. Answer general payroll questions accurately. 
        If the user asks about their company's specific payroll figures, use the provided tool to query the database. Keep responses concise and professional.`,
      },
      {role: 'user', content: userQuery},
    ];

    try {
      const response = await this.client.chat.completions.create({
        model: this.defaultModel,
        messages: messages,
        tools: [
          {
            type: 'function',
            function: {
              name: 'query_payroll_database',
              description: 'Fetches aggregated payroll totals based on specific filters.',
              parameters: {
                type: 'object',
                properties: {
                  departmentName: {
                    type: 'string',
                    description: 'The department name (e.g., Engineering, HR)',
                  },
                  status: {
                    type: 'string',
                    enum: ['DRAFT', 'PROCESSING', 'PROCESSED', 'APPROVED', 'PAID', 'CANCELLED'],
                    description: 'The payroll run status',
                  },
                },
              },
            },
          },
        ],
        tool_choice: 'auto',
      });

      const responseMessage = response.choices[0].message;

      // If no tool was called, it's a general policy question. Return the direct answer.
      if (!responseMessage.tool_calls) {
        return responseMessage.content || 'I could not generate an answer.';
      }

      // If a tool was called, execute the Prisma callback to get real data
      messages.push(responseMessage);

      for (const toolCall of responseMessage.tool_calls) {
        // 1. Tell TypeScript we are explicitly handling a 'function' tool call
        if (toolCall.type === 'function') {
          let functionArgs = {};

          // 2. Safely parse the JSON arguments
          try {
            if (toolCall.function.arguments) {
              functionArgs = JSON.parse(toolCall.function.arguments);
            }
          } catch (parseError) {
            console.warn(
              `Failed to parse AI arguments for ${toolCall.function.name}:`,
              toolCall.function.arguments,
            );
          }

          // 3. Execute your Prisma callback
          const dbResult = await fetchDataCallback(organizationId, functionArgs);

          // 4. Push the result back to the AI
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(dbResult),
          });
        }
      }

      // Send the fetched data back to OpenAI for final summarization
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
