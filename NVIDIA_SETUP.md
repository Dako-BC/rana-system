# NVIDIA NIM Provider Integration Guide

## Overview

The backend has been updated to support NVIDIA NIM API as a new provider alongside Anthropic, OpenAI, Grok, and Gemini. The backend can now run with **only NVIDIA_API_KEY** if Anthropic API key is not available.

## Changes Made

### 1. Optional Anthropic Client

- Anthropic client is now optional and won't crash if `ANTHROPIC_API_KEY` is not set
- Guards added in `call_claude()` and `call_claude_stream()` functions
- Backend can run with other providers only

### 2. NVIDIA Provider Integration

- **Provider Name:** `"nvidia"`
- **Base URL:** Configurable via `NVIDIA_BASE_URL` (default: `https://integrate.api.nvidia.com/v1`)
- **Default Model:** Configurable via `NVIDIA_MODEL` (default: `meta/llama-3.1-8b-instruct`)
- **API Key:** Required `NVIDIA_API_KEY` environment variable

### 3. API Implementation

- Uses OpenAI-compatible `/chat/completions` endpoint
- Proper error handling for authentication (401), rate limiting (429), and connection errors
- Consistent with other provider implementations (OpenAI, Grok, etc.)

### 4. Availability Checking

- NVIDIA provider added to `/api/availability` endpoint
- Returns status of NVIDIA API availability

## Environment Configuration

### Required Variables

Add these to your `backend/.env` file:

```env
# NVIDIA NIM API Configuration
NVIDIA_API_KEY=nvapi-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Optional: Custom base URL (defaults to integrate.api.nvidia.com)
NVIDIA_BASE_URL=https://integrate.api.nvidia.com/v1

# Optional: Default model (defaults to meta/llama-3.1-8b-instruct)
NVIDIA_MODEL=meta/llama-3.1-8b-instruct
```

### Get API Key

1. Visit [NVIDIA NIM API Platform](https://build.nvidia.com/)
2. Sign up / Log in
3. Generate an API key from your account
4. Copy the API key and add to `NVIDIA_API_KEY`

## Usage

### Example: Run with NVIDIA provider

```bash
# Using curl
curl -X POST http://localhost:8000/api/run \
  -H "Content-Type: application/json" \
  -d '{
    "session_id": "session-123",
    "product_context": "Product name: MyWidget\nCategory: Consumer Electronics\nKey advantage: Ultra-fast performance\nTarget audience: Tech enthusiasts\nPain point: Slow processing\nPrice range: $99-$199\nAd platforms: Facebook, Instagram",
    "opts": {
      "provider": "nvidia",
      "model": "meta/llama-3.1-8b-instruct"
    }
  }'
```

### Using Frontend

1. Select "nvidia" from the provider dropdown
2. Optionally select a model from available NVIDIA models
3. Run your marketing campaign as normal

## Available NVIDIA Models

- `meta/llama-3.1-8b-instruct` (default)
- `meta/llama-3.1-70b-instruct`
- `mistralai/mistral-large`
- Other NVIDIA NIM-available models (check API documentation)

## Backward Compatibility

- **Anthropic:** Still works if `ANTHROPIC_API_KEY` is set
- **Other Providers:** No changes to OpenAI, Grok, or Gemini implementations
- **Migration:** Existing sessions and workflows continue to work

## Error Handling

The backend provides clear error messages for common issues:

- `"NVIDIA_API_KEY not set"` - API key is required
- `"NVIDIA API authentication failed"` - Check your API key validity
- `"NVIDIA API rate limit exceeded"` - Wait before retrying
- `"NVIDIA API connection error"` - Check network connectivity and base URL

## Testing Availability

```bash
curl http://localhost:8000/api/availability
```

Response will include NVIDIA status:

```json
{
  "availabilities": {
    "nvidia": {
      "meta/llama-3.1-8b-instruct": {
        "available": true,
        "quota": "API key set"
      }
    }
  }
}
```

## Files Modified

- `backend/main.py`
  - Made Anthropic client optional
  - Added NVIDIA provider configuration
  - Implemented `call_nvidia()` function
  - Updated `call_model()` router
  - Updated `check_nvidia_availability()` function
  - Updated error messages

## Troubleshooting

### Backend won't start

- Check that at least one API key is set: `ANTHROPIC_API_KEY`, `NVIDIA_API_KEY`, `OPENAI_API_KEY`, etc.
- Verify `.env` file is in `backend/` directory

### NVIDIA requests fail with 401

- Verify `NVIDIA_API_KEY` is correct and not expired
- Check that key is properly formatted (`nvapi-...`)

### NVIDIA requests timeout

- Check network connectivity
- Verify `NVIDIA_BASE_URL` is correct (if customized)
- Ensure firewall allows outbound HTTPS to integrate.api.nvidia.com

### Model not found errors

- Ensure `NVIDIA_MODEL` environment variable uses a valid NVIDIA NIM model name
- Check [NVIDIA NIM documentation](https://build.nvidia.com/) for available models

## Performance Considerations

- NVIDIA NIM uses OpenAI-compatible interface: same timeout (30s) as OpenAI/Grok providers
- Default model (`meta/llama-3.1-8b-instruct`) is optimized for marketing use cases
- Can be customized via `NVIDIA_MODEL` environment variable for different trade-offs

## Support

For NVIDIA NIM API issues, refer to:

- NVIDIA NIM Documentation: https://build.nvidia.com/docs
- API Status: Check NVIDIA's status page
- Rate Limits: Standard tier vs Premium tier differences
