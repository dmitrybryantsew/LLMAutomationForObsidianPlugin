import { request } from 'obsidian';
import { OpenRouterModel } from '../types';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/models';

export async function fetchOpenRouterModels(apiKey: string): Promise<OpenRouterModel[]> {
  try {
    const response = await request({
      url: OPENROUTER_API_URL,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    const data = JSON.parse(response);
    return data.data as OpenRouterModel[];
  } catch (error) {
    console.error('Failed to fetch OpenRouter models:', error);
    throw new Error('Failed to fetch models from OpenRouter API.');
  }
}
