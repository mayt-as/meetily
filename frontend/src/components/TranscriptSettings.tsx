import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { Label } from './ui/label';
import { Eye, EyeOff, Lock, Unlock, Save, CheckCircle2 } from 'lucide-react';
import { ModelManager } from './WhisperModelManager';
import { ParakeetModelManager } from './ParakeetModelManager';
import { toast } from 'sonner';

export interface TranscriptModelProps {
    provider: 'localWhisper' | 'parakeet' | 'deepgram' | 'elevenLabs' | 'groq' | 'openai' | 'cloudWhisper';
    model: string;
    apiKey?: string | null;
    endpoint?: string | null;
}

export interface TranscriptSettingsProps {
    transcriptModelConfig: TranscriptModelProps;
    setTranscriptModelConfig: (config: TranscriptModelProps) => void;
    onModelSelect?: () => void;
}

export function TranscriptSettings({ transcriptModelConfig, setTranscriptModelConfig, onModelSelect }: TranscriptSettingsProps) {
    const [apiKey, setApiKey] = useState<string | null>(transcriptModelConfig.apiKey || null);
    const [endpoint, setEndpoint] = useState<string>(transcriptModelConfig.endpoint || '');
    const [customModel, setCustomModel] = useState<string>(transcriptModelConfig.model || 'whisper-1');
    const [showApiKey, setShowApiKey] = useState<boolean>(false);
    const [isApiKeyLocked, setIsApiKeyLocked] = useState<boolean>(true);
    const [isLockButtonVibrating, setIsLockButtonVibrating] = useState<boolean>(false);
    const [uiProvider, setUiProvider] = useState<TranscriptModelProps['provider']>(transcriptModelConfig.provider);
    const [isSaving, setIsSaving] = useState<boolean>(false);
    const [saveSuccess, setSaveSuccess] = useState<boolean>(false);

    // Sync state when backend config changes
    useEffect(() => {
        setUiProvider(transcriptModelConfig.provider);
        setApiKey(transcriptModelConfig.apiKey || null);
        setEndpoint(transcriptModelConfig.endpoint || '');
        setCustomModel(transcriptModelConfig.model || 'whisper-1');
    }, [transcriptModelConfig]);

    useEffect(() => {
        if (transcriptModelConfig.provider === 'localWhisper' || transcriptModelConfig.provider === 'parakeet') {
            setApiKey(null);
        }
    }, [transcriptModelConfig.provider]);

    const fetchApiKey = async (provider: string) => {
        try {
            const data = await invoke('api_get_transcript_api_key', { provider }) as string;
            setApiKey(data || '');
        } catch (err) {
            console.error('Error fetching API key:', err);
            setApiKey(null);
        }
    };

    const modelOptions: Record<string, string[]> = {
        localWhisper: [],
        parakeet: [],
        deepgram: ['nova-2-phonecall'],
        elevenLabs: ['eleven_multilingual_v2'],
        groq: ['whisper-large-v3-turbo', 'whisper-large-v3'],
        openai: ['whisper-1'],
        cloudWhisper: [],
    };

    const defaultEndpoints: Record<string, string> = {
        groq: 'https://api.groq.com/openai/v1',
        openai: 'https://api.openai.com/v1',
        cloudWhisper: 'https://api.openai.com/v1',
    };

    const defaultModels: Record<string, string> = {
        groq: 'whisper-large-v3-turbo',
        openai: 'whisper-1',
        cloudWhisper: 'whisper-1',
    };

    const requiresApiKey = uiProvider === 'deepgram' || uiProvider === 'elevenLabs' || uiProvider === 'openai' || uiProvider === 'groq' || uiProvider === 'cloudWhisper';
    const isCloudProvider = uiProvider === 'openai' || uiProvider === 'groq' || uiProvider === 'cloudWhisper';

    const handleInputClick = () => {
        if (isApiKeyLocked) {
            setIsLockButtonVibrating(true);
            setTimeout(() => setIsLockButtonVibrating(false), 500);
        }
    };

    const handleWhisperModelSelect = (modelName: string) => {
        setTranscriptModelConfig({
            ...transcriptModelConfig,
            provider: 'localWhisper',
            model: modelName
        });
        if (onModelSelect) {
            onModelSelect();
        }
    };

    const handleParakeetModelSelect = (modelName: string) => {
        setTranscriptModelConfig({
            ...transcriptModelConfig,
            provider: 'parakeet',
            model: modelName
        });
        if (onModelSelect) {
            onModelSelect();
        }
    };

    const handleProviderChange = (value: string) => {
        const provider = value as TranscriptModelProps['provider'];
        setUiProvider(provider);

        const newDefaultModel = defaultModels[provider] || (modelOptions[provider]?.[0] || 'whisper-1');
        const newDefaultEndpoint = defaultEndpoints[provider] || '';

        setCustomModel(newDefaultModel);
        setEndpoint(newDefaultEndpoint);

        if (provider !== 'localWhisper' && provider !== 'parakeet') {
            fetchApiKey(provider);
        }

        setTranscriptModelConfig({
            provider,
            model: newDefaultModel,
            apiKey: apiKey,
            endpoint: newDefaultEndpoint,
        });
    };

    const handleSaveCloudSettings = async () => {
        setIsSaving(true);
        try {
            const modelToSave = customModel;
            const endpointToSave = isCloudProvider ? endpoint : null;

            await invoke('api_save_transcript_config', {
                provider: uiProvider,
                model: modelToSave,
                apiKey: apiKey,
                endpoint: endpointToSave,
            });

            setTranscriptModelConfig({
                provider: uiProvider,
                model: modelToSave,
                apiKey: apiKey,
                endpoint: endpointToSave,
            });

            setSaveSuccess(true);
            toast.success('Transcript configuration saved successfully!');
            setTimeout(() => setSaveSuccess(false), 3000);
        } catch (err) {
            console.error('Failed to save cloud transcript settings:', err);
            toast.error('Failed to save settings: ' + String(err));
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div>
            <div>
                <div className="space-y-4 pb-6">
                    <div>
                        <Label className="block text-sm font-medium text-gray-700 mb-1">
                            Transcription Provider
                        </Label>
                        <div className="flex space-x-2 mx-1">
                            <Select
                                value={uiProvider}
                                onValueChange={handleProviderChange}
                            >
                                <SelectTrigger className='focus:ring-1 focus:ring-blue-500 focus:border-blue-500'>
                                    <SelectValue placeholder="Select provider" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="parakeet">⚡ Parakeet (Recommended - Real-time / Local)</SelectItem>
                                    <SelectItem value="localWhisper">🏠 Local Whisper (High Accuracy / Offline)</SelectItem>
                                    <SelectItem value="groq">⚡ Groq Cloud Whisper (Ultra Fast)</SelectItem>
                                    <SelectItem value="openai">☁️ OpenAI Whisper Cloud</SelectItem>
                                    <SelectItem value="cloudWhisper">☁️ Custom Cloud / OpenAI-Compatible STT</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    {/* Local Engines */}
                    {uiProvider === 'localWhisper' && (
                        <div className="mt-6">
                            <ModelManager
                                selectedModel={transcriptModelConfig.provider === 'localWhisper' ? transcriptModelConfig.model : undefined}
                                onModelSelect={handleWhisperModelSelect}
                                autoSave={true}
                            />
                        </div>
                    )}

                    {uiProvider === 'parakeet' && (
                        <div className="mt-6">
                            <ParakeetModelManager
                                selectedModel={transcriptModelConfig.provider === 'parakeet' ? transcriptModelConfig.model : undefined}
                                onModelSelect={handleParakeetModelSelect}
                                autoSave={true}
                            />
                        </div>
                    )}

                    {/* Cloud Engines Configuration */}
                    {isCloudProvider && (
                        <div className="space-y-4 mt-4 p-4 bg-gray-50 border border-gray-200 rounded-lg">
                            {/* Endpoint URL */}
                            <div>
                                <Label className="block text-sm font-medium text-gray-700 mb-1">
                                    Endpoint Base URL
                                </Label>
                                <Input
                                    type="text"
                                    className="focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-white"
                                    value={endpoint}
                                    onChange={(e) => setEndpoint(e.target.value)}
                                    placeholder="e.g. https://api.openai.com/v1 or https://api.groq.com/openai/v1"
                                />
                                <p className="text-xs text-gray-500 mt-1">
                                    OpenAI-compatible speech-to-text API base endpoint URL
                                </p>
                            </div>

                            {/* Model Name */}
                            <div>
                                <Label className="block text-sm font-medium text-gray-700 mb-1">
                                    Model Name
                                </Label>
                                {modelOptions[uiProvider] && modelOptions[uiProvider].length > 0 ? (
                                    <Select
                                        value={customModel}
                                        onValueChange={(val) => setCustomModel(val)}
                                    >
                                        <SelectTrigger className="bg-white focus:ring-1 focus:ring-blue-500 focus:border-blue-500">
                                            <SelectValue placeholder="Select model" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {modelOptions[uiProvider].map((m) => (
                                                <SelectItem key={m} value={m}>{m}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                ) : (
                                    <Input
                                        type="text"
                                        className="focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-white"
                                        value={customModel}
                                        onChange={(e) => setCustomModel(e.target.value)}
                                        placeholder="e.g. whisper-1, whisper-large-v3, etc."
                                    />
                                )}
                            </div>

                            {/* API Key */}
                            {requiresApiKey && (
                                <div>
                                    <Label className="block text-sm font-medium text-gray-700 mb-1">
                                        API Key
                                    </Label>
                                    <div className="relative">
                                        <Input
                                            type={showApiKey ? "text" : "password"}
                                            className={`pr-24 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 ${isApiKeyLocked ? 'bg-gray-100 cursor-not-allowed' : 'bg-white'}`}
                                            value={apiKey || ''}
                                            onChange={(e) => setApiKey(e.target.value)}
                                            disabled={isApiKeyLocked}
                                            onClick={handleInputClick}
                                            placeholder="Enter your API key"
                                        />
                                        {isApiKeyLocked && (
                                            <div
                                                onClick={handleInputClick}
                                                className="absolute inset-0 flex items-center justify-center bg-gray-100 bg-opacity-50 rounded-md cursor-not-allowed"
                                            />
                                        )}
                                        <div className="absolute inset-y-0 right-0 pr-1 flex items-center">
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => setIsApiKeyLocked(!isApiKeyLocked)}
                                                className={`transition-colors duration-200 ${isLockButtonVibrating ? 'animate-vibrate text-red-500' : ''}`}
                                                title={isApiKeyLocked ? "Unlock to edit" : "Lock to prevent editing"}
                                            >
                                                {isApiKeyLocked ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
                                            </Button>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => setShowApiKey(!showApiKey)}
                                            >
                                                {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Save Button for Cloud Settings */}
                            <div className="pt-2">
                                <Button
                                    type="button"
                                    onClick={handleSaveCloudSettings}
                                    disabled={isSaving}
                                    className="w-full sm:w-auto bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-2"
                                >
                                    {saveSuccess ? (
                                        <>
                                            <CheckCircle2 className="w-4 h-4 text-green-300" />
                                            <span>Saved!</span>
                                        </>
                                    ) : (
                                        <>
                                            <Save className="w-4 h-4" />
                                            <span>{isSaving ? 'Saving...' : 'Save Cloud Configuration'}</span>
                                        </>
                                    )}
                                </Button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
