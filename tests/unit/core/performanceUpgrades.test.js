import { jest } from '@jest/globals';
import { SemanticCache } from '../../../src/core/semanticCache.js';
import { ContextOptimizer } from '../../../src/core/contextOptimizer.js';
import { ConnectionPool } from '../../../src/core/connectionPool.js';
import { ModelManager } from '../../../src/ollama/models.js';
import { OllamaConnectionError } from '../../../src/ollama/client.js';
import { Agent } from '../../../src/core/agent.js';
import { Planner } from '../../../src/core/planner.js';
import { MemoryManager } from '../../../src/core/memory.js';
import fs from 'fs';
import path from 'path';

describe('Performance Upgrades', () => {
  describe('ModelManager Quantization Detection', () => {
    let mockClient;
    let modelManager;

    beforeEach(() => {
      mockClient = {};
      modelManager = new ModelManager(mockClient);
    });

    test('detects quantization levels and performance tiers', () => {
      const q4 = modelManager.detectQuantization('llama3:8b-q4_K_M');
      expect(q4.label).toBe('Q4_K_M');
      expect(q4.tier).toBe('recommended');
      expect(q4.warning).toBeNull();

      const fp16 = modelManager.detectQuantization('mistral:7b-fp16');
      expect(fp16.label).toBe('FP16');
      expect(fp16.tier).toBe('slow');
      expect(fp16.warning).toContain('Full precision');

      const nonQuant = modelManager.detectQuantization('llama3:8b');
      expect(nonQuant).toBeNull();
    });
  });

  describe('SemanticCache', () => {
    let mockClient;

    beforeEach(() => {
      mockClient = {
        embed: jest.fn()
      };
    });

    test('performs cache lookup and store correctly', async () => {
      const cache = new SemanticCache(mockClient, {
        enabled: true,
        similarityThreshold: 0.9,
        maxSize: 3,
        ttlMinutes: 10
      });

      mockClient.embed.mockResolvedValueOnce([1, 0, 0]);
      await cache.store('What is node?', 'Node is JS runtime.');

      mockClient.embed.mockResolvedValueOnce([1, 0, 0]);
      const hit = await cache.lookup('What is node?');
      expect(hit.hit).toBe(true);
      expect(hit.response).toBe('Node is JS runtime.');
      expect(hit.similarity).toBeCloseTo(1.0);

      mockClient.embed.mockResolvedValueOnce([0, 1, 0]);
      const miss = await cache.lookup('Tell me a joke.');
      expect(miss.hit).toBe(false);
    });

    test('evicts LRU entries when cache exceeds maxSize', async () => {
      const cache = new SemanticCache(mockClient, {
        enabled: true,
        similarityThreshold: 0.9,
        maxSize: 2
      });

      mockClient.embed.mockResolvedValue([1, 0, 0]);
      await cache.store('q1', 'r1');
      await cache.store('q2', 'r2');
      await cache.store('q3', 'r3');

      expect(cache._entries).toHaveLength(2);
      expect(cache._entries.find(e => e.query === 'q1')).toBeUndefined();
      expect(cache._entries.find(e => e.query === 'q2')).toBeDefined();
      expect(cache._entries.find(e => e.query === 'q3')).toBeDefined();
    });

    test('falls back to hash-based pseudo-embeddings if client.embed fails', async () => {
      const cache = new SemanticCache(mockClient, {
        enabled: true,
        similarityThreshold: 0.9
      });

      mockClient.embed.mockRejectedValue(new Error('no embed model'));

      await cache.store('query 1', 'response 1');
      const hit = await cache.lookup('query 1');
      expect(hit.hit).toBe(true);
      expect(hit.response).toBe('response 1');
    });
  });

  describe('ContextOptimizer', () => {
    let mockClient;
    let optimizer;

    beforeEach(() => {
      mockClient = {
        generate: jest.fn()
      };
      optimizer = new ContextOptimizer(mockClient, {
        budgetThreshold: 0.5,
        keepRecentTurns: 1,
        minMessagesToCompress: 4
      });
    });

    test('determines when optimization should run', () => {
      expect(optimizer.shouldOptimize(80, 100, 3)).toBe(false);
      expect(optimizer.shouldOptimize(40, 100, 5)).toBe(false);
      expect(optimizer.shouldOptimize(60, 100, 5)).toBe(true);
    });

    test('optimizes message history, keeping recent messages and summarizing old ones', async () => {
      mockClient.generate.mockResolvedValue('Summary of old talk.');

      const messages = [
        { role: 'user', content: 'hello', tokens: 5 },
        { role: 'assistant', content: 'hi there', tokens: 5 },
        { role: 'user', content: 'need code', tokens: 5 },
        { role: 'assistant', content: 'here is code', tokens: 5 },
        { role: 'user', content: 'most recent', tokens: 5 },
        { role: 'assistant', content: 'most recent reply', tokens: 5 }
      ];

      const optimized = await optimizer.optimize(messages, 'llama3');

      expect(optimized).toHaveLength(3);
      expect(optimized[0].content).toContain('Summary of old talk.');
      expect(optimized[1].content).toBe('most recent');
      expect(optimized[2].content).toBe('most recent reply');
    });
  });

  describe('ConnectionPool', () => {
    let hosts;
    let mockFetch;

    beforeEach(() => {
      hosts = ['http://host1:11434', 'http://host2:11434'];
      mockFetch = jest.fn();
      global.fetch = mockFetch;
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    test('distributes requests round-robin', async () => {
      const pool = new ConnectionPool(hosts, { healthCheckIntervalMs: 100000 });
      
      const mockResult1 = { response: 'r1' };
      const mockResult2 = { response: 'r2' };

      jest.spyOn(pool._pool[0].client, 'chat').mockResolvedValue(mockResult1);
      jest.spyOn(pool._pool[1].client, 'chat').mockResolvedValue(mockResult2);

      const res1 = await pool.chat('m', []);
      expect(res1).toBe(mockResult1);
      expect(pool._pool[0].totalRequests).toBe(1);
      expect(pool._pool[1].totalRequests).toBe(0);

      const res2 = await pool.chat('m', []);
      expect(res2).toBe(mockResult2);
      expect(pool._pool[0].totalRequests).toBe(1);
      expect(pool._pool[1].totalRequests).toBe(1);

      pool.shutdown();
    });

    test('fails over to healthy hosts if a host throws OllamaConnectionError', async () => {
      const pool = new ConnectionPool(hosts, { healthCheckIntervalMs: 100000 });

      const connectionError = new OllamaConnectionError('Connection refused');
      jest.spyOn(pool._pool[0].client, 'chat').mockRejectedValue(connectionError);

      const mockResult = { response: 'success' };
      jest.spyOn(pool._pool[1].client, 'chat').mockResolvedValue(mockResult);

      const res = await pool.chat('m', []);
      expect(res).toBe(mockResult);
      expect(pool._pool[0].healthy).toBe(false);
      expect(pool._pool[1].totalRequests).toBe(1);

      pool.shutdown();
    });
  });

  describe('Speed & Performance Options', () => {
    let mockConfig;
    let mockClient;

    beforeEach(() => {
      mockConfig = {
        get: jest.fn((key) => {
          if (key === 'contextWindowTokens') return 4096;
          if (key === 'keepAlive') return '15m';
          if (key === 'numGpu') return 30;
          if (key === 'numThread') return 4;
          return null;
        })
      };
      mockClient = {
        chat: jest.fn().mockResolvedValue({ content: 'hi' }),
        streamChat: jest.fn().mockResolvedValue('hi'),
        generate: jest.fn().mockResolvedValue('hi')
      };
    });

    test('MemoryManager limits context window tokens for small models', () => {
      const smallModel = { name: 'qwen:0.5b', isSmall: true };
      const largeModel = { name: 'llama3:70b', isSmall: false };

      const memorySmall = new MemoryManager(mockConfig, smallModel);
      expect(memorySmall.maxContextTokens).toBe(2048);

      const memoryLarge = new MemoryManager(mockConfig, largeModel);
      expect(memoryLarge.maxContextTokens).toBe(4096);

      memorySmall.updateModel(largeModel);
      expect(memorySmall.maxContextTokens).toBe(4096);
    });

    test('Agent retrieves correct speed settings through _getCommonOptions', () => {
      const model = { name: 'qwen:0.5b', isSmall: true };
      const agent = new Agent({
        client: mockClient,
        memory: {
          setSystemPrompt: jest.fn(),
          addMessage: jest.fn()
        },
        session: { projectInfo: {} },
        config: mockConfig,
        currentModel: model
      });

      const options = agent._getCommonOptions();
      expect(options.keepAlive).toBe('15m');
      expect(options.numGpu).toBe(30);
      expect(options.numThread).toBe(4);
      expect(options.contextSize).toBe(2048);

      // Large model
      agent.updateModel({ name: 'llama3:70b', isSmall: false });
      const optionsLarge = agent._getCommonOptions();
      expect(optionsLarge.contextSize).toBe(4096);
    });

    test('Planner applies config speed settings to client.generate options', async () => {
      const model = { name: 'qwen:0.5b', isSmall: true };
      const planner = new Planner(mockClient, mockConfig);

      await planner.generatePlan('task', model, null);

      expect(mockClient.generate).toHaveBeenCalledWith(
        'qwen:0.5b',
        expect.any(String),
        expect.objectContaining({
          temperature: 0.1,
          keepAlive: '15m',
          numGpu: 30,
          numThread: 4,
          contextSize: 2048
        })
      );
    });
  });

  describe('File & Folder Mentions', () => {
    const TEST_MENTIONS_DIR = path.join(process.cwd(), 'tests', 'temp_mentions_dir');
    let agent;

    beforeAll(() => {
      fs.mkdirSync(TEST_MENTIONS_DIR, { recursive: true });
      fs.writeFileSync(path.join(TEST_MENTIONS_DIR, 'test_file.txt'), 'Hello world from test file!');
      fs.mkdirSync(path.join(TEST_MENTIONS_DIR, 'sub_dir'), { recursive: true });
      fs.writeFileSync(path.join(TEST_MENTIONS_DIR, 'sub_dir', 'inner.txt'), 'Inner content');
    });

    afterAll(() => {
      fs.rmSync(TEST_MENTIONS_DIR, { recursive: true, force: true });
    });

    beforeEach(() => {
      const mockConfig = {
        get: jest.fn(() => null)
      };
      const mockClient = {
        chat: jest.fn(),
        streamChat: jest.fn()
      };
      const mockMemory = {
        setSystemPrompt: jest.fn(),
        addMessage: jest.fn()
      };
      const mockSession = {
        projectPath: TEST_MENTIONS_DIR,
        projectInfo: {
          fileTree: [
            { path: 'test_file.txt', isDir: false, name: 'test_file.txt' },
            { path: 'sub_dir', isDir: true, name: 'sub_dir' },
            { path: 'sub_dir/inner.txt', isDir: false, name: 'inner.txt' }
          ]
        }
      };

      agent = new Agent({
        client: mockClient,
        memory: mockMemory,
        session: mockSession,
        config: mockConfig,
        currentModel: { name: 'qwen:0.5b', isSmall: true }
      });
    });

    test('resolveMentions() replaces @file references with actual content', async () => {
      const input = 'Please review @test_file.txt';
      const output = await agent.resolveMentions(input);

      expect(output).toContain('Please review @test_file.txt');
      expect(output).toContain('[ATTACHED FILE: test_file.txt]');
      expect(output).toContain('Hello world from test file!');
    });

    test('resolveMentions() replaces #folder references with directory listings', async () => {
      const input = 'Check directory #sub_dir';
      const output = await agent.resolveMentions(input);

      expect(output).toContain('Check directory #sub_dir');
      expect(output).toContain('[ATTACHED FOLDER: sub_dir/]');
      expect(output).toContain('- inner.txt');
    });

    test('resolveMentions() handles non-existent file/folder references gracefully', async () => {
      const input = 'Check @nonexistent.txt and #nonexistent_dir';
      const output = await agent.resolveMentions(input);

      expect(output).toBe(input);
    });
  });
});
