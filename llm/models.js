const API_KEYS = {
    anthropic: process.env.ANTHROPIC_API_KEY,
    grok: process.env.XAI_API_KEY,
    openai: process.env.OPENAI_API_KEY,
    gemini: process.env.GOOGLE_GEMINI_API_KEY,
};

const PROVIDER_MODELS = {
    anthropic: [
        "claude-3-5-haiku-20241022",
        "claude-3-5-sonnet-20241022",
        "claude-opus-4-1-20250805",
    ],
    grok: [
        "grok-beta",
        "grok-2-latest",
    ],
    openai: [
        "gpt-4o-mini",
        "gpt-4-turbo",
        "gpt-4o",
    ],
    gemini: [
        "gemini-1.5-flash",
        "gemini-1.5-pro",
    ],
};

const DEFAULT_MODEL_BY_PROVIDER = Object.fromEntries(
    Object.entries(PROVIDER_MODELS).map(([provider, models]) => [provider, models[0]])
);

function getModel(model, provider) {
    const providerModels = PROVIDER_MODELS[provider];
    if (!providerModels) {
        throw new Error(`Unknown provider: ${provider}`);
    }

    if (!providerModels.includes(model)) {
        throw new Error(`Unknown model for ${provider}: ${model}`);
    }

    return model;
}

export { API_KEYS, PROVIDER_MODELS, DEFAULT_MODEL_BY_PROVIDER, getModel };
