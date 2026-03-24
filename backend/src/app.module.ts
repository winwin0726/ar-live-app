import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
// import { TypeOrmModule } from '@nestjs/typeorm'; // [임시비활성화] PostgreSQL 없는 환경에서 실행 시 주석 처리
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AppGateway } from './app.gateway';
import { AiModule } from './ai/ai.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // TypeOrmModule.forRoot({                  // [임시비활성화]
    //   type: 'postgres',                      // PostgreSQL이 실행 중이면 주석 해제
    //   host: 'localhost',
    //   port: 5432,
    //   username: 'admin',
    //   password: 'rootpassword',
    //   database: 'antigravity',
    //   autoLoadEntities: true,
    //   synchronize: true,
    // }),
    AiModule,
  ],
  controllers: [AppController],
  providers: [AppService, AppGateway],
})
export class AppModule {}
