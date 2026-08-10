import { EntityTarget, ObjectLiteral, Repository } from 'typeorm';
import { initializeDataSource } from './data-source';

export async function getRepository<T extends ObjectLiteral>(
  entity: EntityTarget<T>
): Promise<Repository<T>> {
  const dataSource = await initializeDataSource();
  return dataSource.getRepository(entity) as unknown as Repository<T>;
}