import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true, length: 254 })
  email: string;

  // Null for accounts created through a social provider (US-012).
  @Column({ name: 'password_hash', type: 'varchar', length: 72, nullable: true })
  passwordHash: string | null;

  // Explicit type: TypeScript reports `string | null` as Object, which TypeORM can't map.
  @Column({ name: 'first_name', type: 'varchar', length: 100, nullable: true })
  firstName: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
