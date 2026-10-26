import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { User } from './user.entity';
import { UserIdentity } from './oauth/user-identity.entity';
import { OAuthService } from './oauth/oauth.service';
import { OAuthController } from './oauth/oauth.controller';

@Module({
  imports: [TypeOrmModule.forFeature([User, UserIdentity])],
  controllers: [AuthController, OAuthController],
  providers: [AuthService, OAuthService],
})
export class AuthModule {}
