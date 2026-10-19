import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('likes')
@Index(['postId', 'userId'], { unique: true })
export class Like {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  postId: string;

  @Index()
  @Column()
  userId: string;

  @CreateDateColumn()
  createdAt: Date;
}
