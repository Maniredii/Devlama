import { FileWriter, FileExistsError } from '../../../src/tools/fileWriter.js';
import { readFileSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';

describe('FileWriter', () => {
  const TEST_DIR = join(process.cwd(), 'tests', 'temp_writer_dir');
  const writer = new FileWriter();

  beforeAll(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterAll(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  test('createFile() creates a file', async () => {
    const path = join(TEST_DIR, 'new_file.txt');
    const res = await writer.createFile(path, 'content');
    
    expect(res.operation).toBe('create');
    expect(readFileSync(path, 'utf-8')).toBe('content');
  });

  test('createFile() throws if file exists', async () => {
    const path = join(TEST_DIR, 'existing.txt');
    await writer.writeFile(path, 'old');
    
    await expect(writer.createFile(path, 'new')).rejects.toThrow();
  });
});
