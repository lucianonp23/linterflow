import { Injectable, ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from '../entities/user.entity';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly jwtService: JwtService,
  ) {}

  async register(registerDto: RegisterDto) {
    const existingUser = await this.userRepository.findOne({
      where: [
        { username: registerDto.username },
        { email: registerDto.email },
      ],
    });

    if (existingUser) {
      if (existingUser.username === registerDto.username) {
        throw new ConflictException('Username is already taken');
      }
      throw new ConflictException('Email is already registered');
    }

    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(registerDto.password, saltRounds);

    const user = this.userRepository.create({
      username: registerDto.username,
      email: registerDto.email,
      passwordHash,
      fullName: registerDto.fullName,
      avatarUrl: registerDto.avatarUrl || `https://api.dicebear.com/7.x/bottts/svg?seed=${registerDto.username}`,
      bio: registerDto.bio || 'Hello world! Just joined the network.',
    });

    const savedUser = await this.userRepository.save(user);
    const token = this.generateToken(savedUser);

    const { passwordHash: _, ...result } = savedUser;
    return {
      user: result,
      accessToken: token,
    };
  }

  async login(loginDto: LoginDto) {
    const user = await this.userRepository.findOne({
      where: [
        { username: loginDto.usernameOrEmail },
        { email: loginDto.usernameOrEmail },
      ],
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(loginDto.password, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const token = this.generateToken(user);
    const { passwordHash: _, ...result } = user;

    return {
      user: result,
      accessToken: token,
    };
  }

  generateToken(user: User): string {
    const payload = { sub: user.id, username: user.username, email: user.email };
    return this.jwtService.sign(payload);
  }
}
