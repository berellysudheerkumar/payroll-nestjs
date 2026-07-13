import {Controller, Post, Body} from '@nestjs/common';
import {AuthService} from './auth.service';
import {Get, UseGuards} from '@nestjs/common';
import {JwtAuthGuard} from './guards/jwt-auth.guard';
import {CurrentUser} from './decorators/current-user.decorator';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('register')
  register(@Body() body: any) {
    return this.authService.register(body);
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
