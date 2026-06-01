import { FileReader, FileNotFoundError, FileTooLargeError } from '../../../src/tools/fileReader.js';
import { writeFileSync, mkdirSync, rmdirSync, rmSync } from 'fs';
import { join } from 'path';

describe('FileReader', () => {
  const TEST_DIR = join(process.cwd(), 'tests', 'temp_reader_dir');
  const reader = new FileReader();

  beforeAll(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    writeFileSync(join(TEST_DIR, 'test.txt'), 'hello world');
  });

  afterAll(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  test('readFile() reads text file', async () => {
    const content = await reader.readFile(join(TEST_DIR, 'test.txt'));
    expect(content).toBe('hello world');
  });

  test('readFile() throws on missing file', async () => {
    await expect(reader.readFile(join(TEST_DIR, 'missing.txt')))
      .rejects.toThrow();
  });
});
