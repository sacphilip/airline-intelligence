import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true, length: 254 })
  email: string;

  @Column({ name: 'password_hash', length: 72 })
  passwordHash: string;

  @Column({ name: 'first_name', length: 100, nullable: true })
  firstName: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
