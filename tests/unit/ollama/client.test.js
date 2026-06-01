import { jest } from '@jest/globals';
import { OllamaClient, OllamaError } from '../../../src/ollama/client.js';

describe('OllamaClient', () => {
  let client;
  let mockFetch;

  beforeEach(() => {
    client = new OllamaClient('http://localhost:11434');
    mockFetch = jest.fn();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('listModels() fetches and returns models', async () => {
    const mockTagsResponse = {
      models: [
        { name: 'llama3:8b', size: 1000 },
        { name: 'qwen2.5:7b', size: 2000 }
      ]
    };
    
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockTagsResponse)
    });

    const models = await client.listModels();
    expect(models).toHaveLength(2);
    expect(models[0].name).toBe('llama3:8b');
    expect(mockFetch).toHaveBeenCalledWith('http://localhost:11434/api/tags', expect.any(Object));
  });

  test('chat() handles errors correctly', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: () => Promise.resolve('model not found')
    });

    await expect(client.chat('non-existent-model', [{role: 'user', content: 'hi'}]))
      .rejects.toThrow(OllamaError);
  });
});
