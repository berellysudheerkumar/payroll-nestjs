import {Controller, Post, Body, Get, UseGuards} from '@nestjs/common';
import {AuthService} from './auth.service';
import {JwtAuthGuard} from './guards/jwt-auth.guard';
import {CurrentUser} from './decorators/current-user.decorator';
import {EmployeeSignUpDto} from './dto/employee-signup.dto';
import {ApiOperation, ApiResponse, ApiTags} from '@nestjs/swagger';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('register')
  register(@Body() body: any) {
    return this.authService.register(body);
  }

  @Post('employee-signup')
  @ApiOperation({summary: 'Employee self-service registration (Strictly EMPLOYEE role)'})
  @ApiResponse({status: 201, description: 'Employee registered and logged in successfully'})
  @ApiResponse({status: 404, description: 'Organization code not found'})
  @ApiResponse({status: 409, description: 'User email or employee code conflict'})
  employeeSignUp(@Body() dto: EmployeeSignUpDto) {
    return this.authService.registerEmployee(dto);
  }

  @Post('login')
  login(@Body() body: any) {
    return this.authService.login(body.email, body.password);
  }
  @Get('profile')
  @UseGuards(JwtAuthGuard)
  profile(@CurrentUser() user: any) {
    return user;
  }
}
