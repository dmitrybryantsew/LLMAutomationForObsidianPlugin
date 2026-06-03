async function generateText(payload: { message: string; files: any[]; model: string; text_type: string; language: string; openrouter_api_key?: string }) {
    const response = await fetch("http://127.0.0.1:8001/generate-text", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return response.json();
  }
  
async function generateImage(options: { prompt: string; model: string, backend?: string, openrouter_api_key?: string }) {
    const response = await fetch("http://127.0.0.1:8001/generate-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(options),
    });
    return response.json();
  }

  export { generateText };
  export { generateImage };
