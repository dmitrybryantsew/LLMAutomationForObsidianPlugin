# Multi-Provider LLM Architecture - Test Documentation

## Overview

This document provides comprehensive information about the test suite for the multi-provider LLM architecture, including OpenRouter, Chutes, and ZAI providers.

## Test Organization

The test suite is organized into two main categories:

### Unit Tests (`tests/unit/`)
Test individual components in isolation using mocks.

- **`BaseLLMClient.test.ts`** - Tests for the abstract base class
  - Message building logic
  - Error response parsing
  - Metadata extraction
  - Retry logic with exponential backoff
  - API key updates
  - Configuration management

- **`LLMClientFactory.test.ts`** - Tests for the factory pattern
  - Client creation for all providers
  - Provider string parsing
  - Provider name retrieval
  - Client creation from settings

### Integration Tests (`tests/integration/`)
Test provider implementations with mocked API calls.

- **`OpenRouterProvider.test.ts`** - Tests for OpenRouter integration
  - Text generation
  - Vision analysis
  - API-specific headers (HTTP-Referer)
  - Error handling and retry logic

- **`ChutesProvider.test.ts`** - Tests for Chutes integration
  - Text generation
  - Vision analysis
  - API-specific headers (no HTTP-Referer)
  - Error handling and retry logic

- **`ZAIProvider.test.ts`** - Tests for ZAI integration
  - Text generation
  - Vision analysis
  - API-specific headers (no HTTP-Referer)
  - Error handling and retry logic

## Running Tests

### Run All Tests
```bash
npm test
```

### Run Tests in Watch Mode
```bash
npm run test:watch
```

### Run Tests with Coverage
```bash
npm run test:coverage
```

### Run Specific Test File
```bash
npm test tests/unit/BaseLLMClient.test.ts
```

### Run Tests Matching a Pattern
```bash
npm test -- --grep "generateText"
```

## Test Coverage

### Current Coverage

| Component | Unit Tests | Integration Tests | Total |
|-----------|------------|-------------------|-------|
| BaseLLMClient | 25+ | - | 25+ |
| LLMClientFactory | 20+ | - | 20+ |
| OpenRouterProvider | - | 15+ | 15+ |
| ChutesProvider | - | 10+ | 10+ |
| ZAIProvider | - | 10+ | 10+ |
| **Total** | **45+** | **35+** | **80+** |

### Coverage Areas

#### BaseLLMClient
- ✅ Message building with file context
- ✅ Message building without file context
- ✅ Language instruction inclusion
- ✅ Error response parsing
- ✅ Metadata extraction
- ✅ Retry logic with exponential backoff
- ✅ API key updates
- ✅ Timeout configuration
- ✅ Retry count configuration

#### LLMClientFactory
- ✅ OpenRouter client creation
- ✅ Chutes client creation
- ✅ ZAI client creation
- ✅ Provider string parsing (case insensitive)
- ✅ Provider string parsing (whitespace handling)
- ✅ Provider name retrieval from enum
- ✅ Client creation from settings with API key validation
- ✅ Error handling for invalid provider

#### OpenRouterProvider
- ✅ Text generation with various configurations
- ✅ Language instruction inclusion
- ✅ File context handling
- ✅ Correct headers (Authorization, Content-Type, HTTP-Referer)
- ✅ Correct API endpoint
- ✅ Vision analysis functionality
- ✅ Error handling and retry logic
- ✅ Default parameter values

#### ChutesProvider
- ✅ Text generation
- ✅ Vision analysis
- ✅ Correct headers (Authorization, Content-Type, no HTTP-Referer)
- ✅ Correct API endpoint
- ✅ Error handling and retry logic

#### ZAIProvider
- ✅ Text generation
- ✅ Vision analysis
- ✅ Correct headers (Authorization, Content-Type, no HTTP-Referer)
- ✅ Correct API endpoint
- ✅ Error handling and retry logic

## Mock Strategies

### Global Fetch Mocking

We use Vitest's `vi.fn()` to mock the global `fetch` function:

```typescript
import { vi } from 'vitest';

let mockFetch: any;

beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch;
});

afterEach(() => {
    vi.restoreAllMocks();
});
```

### Mock API Responses

#### Successful Response
```typescript
mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
        id: 'test-id',
        model: 'test-model',
        created: 1234567890,
        choices: [{
            message: { content: 'Generated text' }
        }]
    })
});
```

#### Error Response
```typescript
mockFetch.mockResolvedValueOnce({
    ok: false,
    status: 401,
    json: async () => ({
        error: { message: 'Invalid API key' }
    })
});
```

#### Network Error
```typescript
mockFetch.mockRejectedValueOnce(new Error('Network error'));
```

#### Retry Scenario
```typescript
mockFetch
    .mockRejectedValueOnce(new Error('Network error'))
    .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
            id: 'test-id',
            model: 'test-model',
            created: 1234567890,
            choices: [{ message: { content: 'Success after retry' } }]
        })
    });
```

### Verifying Mock Calls

```typescript
// Check number of calls
expect(mockFetch).toHaveBeenCalledTimes(2);

// Check call arguments
const callArgs = mockFetch.mock.calls[0];
expect(callArgs[0]).toBe('https://api.openrouter.ai/api/v1/chat/completions');

// Check headers
const headers = callArgs[1].headers;
expect(headers['Authorization']).toBe('Bearer test-api-key');

// Check request body
const requestBody = JSON.parse(callArgs[1].body);
expect(requestBody.model).toBe('test-model');
```

## Test Patterns

### Pattern 1: Successful Operation

```typescript
it('should generate text successfully', async () => {
    // Arrange
    const mockResponse = { /* ... */ };
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => mockResponse });
    
    const options: TextGenerationOptions = { /* ... */ };
    
    // Act
    const result = await provider.generateText(options);
    
    // Assert
    expect(result.output).toBe('Generated text');
    expect(result.metadata).toBeDefined();
});
```

### Pattern 2: Error Handling

```typescript
it('should handle API errors', async () => {
    // Arrange
    mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ error: { message: 'Invalid API key' } })
    });
    
    const options: TextGenerationOptions = { /* ... */ };
    
    // Act & Assert
    await expect(provider.generateText(options)).rejects.toThrow('Invalid API key');
});
```

### Pattern 3: Retry Logic

```typescript
it('should retry on network errors', async () => {
    // Arrange
    mockFetch
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
            ok: true,
            json: async () => ({ /* success response */ })
        });
    
    const options: TextGenerationOptions = { /* ... */ };
    
    // Act
    const result = await provider.generateText(options);
    
    // Assert
    expect(result.output).toBe('Success after retry');
    expect(mockFetch).toHaveBeenCalledTimes(2);
});
```

### Pattern 4: Header Verification

```typescript
it('should use correct headers', async () => {
    // Arrange
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => mockResponse });
    
    const options: TextGenerationOptions = { /* ... */ };
    
    // Act
    await provider.generateText(options);
    
    // Assert
    const callArgs = mockFetch.mock.calls[0];
    const headers = callArgs[1].headers;
    expect(headers['Authorization']).toBe('Bearer test-api-key');
    expect(headers['Content-Type']).toBe('application/json');
});
```

## CI/CD Integration

### GitHub Actions Example

```yaml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run tests
        run: npm test
      
      - name: Generate coverage
        run: npm run test:coverage
      
      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./coverage/coverage-final.json
```

### GitLab CI Example

```yaml
test:
  stage: test
  image: node:18
  
  script:
    - npm ci
    - npm test
    - npm run test:coverage
  
  coverage: '/All files[^|]*\|[^|]*\s+([\d\.]+)/'
  artifacts:
    reports:
      coverage_report:
        coverage_format: cobertura
        path: coverage/cobertura-coverage.xml
```

## Best Practices

### 1. Isolate Tests
Each test should be independent and not rely on the state of other tests.

### 2. Use Descriptive Names
Test names should clearly describe what is being tested:

```typescript
// Good
it('should retry on network errors with exponential backoff', async () => {
    // ...
});

// Bad
it('test retry', async () => {
    // ...
});
```

### 3. Arrange-Act-Assert Pattern
Organize tests using the AAA pattern for clarity:

```typescript
it('should generate text', async () => {
    // Arrange
    const mockResponse = { /* ... */ };
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => mockResponse });
    const options = { /* ... */ };
    
    // Act
    const result = await provider.generateText(options);
    
    // Assert
    expect(result.output).toBe('Expected output');
});
```

### 4. Test Edge Cases
Don't just test the happy path:

```typescript
// Test success case
it('should generate text successfully', async () => { /* ... */ });

// Test error cases
it('should handle invalid API key', async () => { /* ... */ });
it('should handle network timeout', async () => { /* ... */ });
it('should handle malformed response', async () => { /* ... */ });

// Test edge cases
it('should handle empty message', async () => { /* ... */ });
it('should handle very long message', async () => { /* ... */ });
it('should handle special characters', async () => { /* ... */ });
```

### 5. Use Meaningful Mock Data
Mock data should be realistic and representative:

```typescript
// Good
const mockResponse = {
    id: 'chatcmpl-test-id',
    model: 'openai/gpt-4',
    created: 1234567890,
    choices: [{
        message: {
            content: 'Generated text from OpenRouter'
        }
    }]
};

// Bad
const mockResponse = {
    data: 'some data'
};
```

### 6. Clean Up After Tests
Always restore mocks after each test:

```typescript
afterEach(() => {
    vi.restoreAllMocks();
});
```

## Troubleshooting

### Tests Failing with "fetch is not defined"

**Problem**: Global fetch is not mocked properly.

**Solution**: Ensure you're mocking fetch in `beforeEach`:

```typescript
beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch;
});
```

### Tests Failing with "Cannot read property 'mock' of undefined"

**Problem**: Mock is not initialized before test.

**Solution**: Initialize mock before using it:

```typescript
let mockFetch: any;

beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch;
});
```

### Tests Timing Out

**Problem**: Tests are waiting for real API calls.

**Solution**: Ensure all API calls are mocked:

```typescript
// Make sure to mock fetch before calling provider methods
mockFetch.mockResolvedValueOnce({ ok: true, json: async () => mockResponse });
const result = await provider.generateText(options);
```

### Tests Passing When They Should Fail

**Problem**: Mocks are not being called.

**Solution**: Verify mock calls:

```typescript
expect(mockFetch).toHaveBeenCalled();
expect(mockFetch).toHaveBeenCalledTimes(1);
```

## Future Enhancements

### Planned Test Additions

1. **End-to-End Tests**
   - Test complete workflows with real API calls (using test keys)
   - Test provider switching in real scenarios
   - Test error recovery in production-like conditions

2. **Performance Tests**
   - Measure response times for each provider
   - Test concurrent requests
   - Test memory usage

3. **Contract Tests**
   - Verify API contracts match provider documentation
   - Test backward compatibility
   - Test API version changes

4. **Integration with Plugin**
   - Test integration with existing plugin code
   - Test settings integration
   - Test UI integration

## Contributing

When adding new tests:

1. Follow the existing test patterns
2. Use descriptive test names
3. Test both success and failure cases
4. Add comments for complex test logic
5. Update this documentation
6. Ensure all tests pass before submitting

## Resources

- [Vitest Documentation](https://vitest.dev/)
- [Testing Best Practices](https://github.com/goldbergyoni/javascript-testing-best-practices)
- [Mock Testing Guide](https://testingjavascript.com/)
- [Multi-Provider Architecture Documentation](../src/utils/MultiProviderArchitecture.README.md)