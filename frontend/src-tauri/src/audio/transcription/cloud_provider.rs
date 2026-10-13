// audio/transcription/cloud_provider.rs
//
// OpenAI-compatible Cloud Speech-to-Text (STT) provider implementation.

use super::provider::{TranscriptionError, TranscriptionProvider, TranscriptResult};
use async_trait::async_trait;
use log::{error, info};
use reqwest::multipart;
use serde::Deserialize;
use std::time::Duration;

#[derive(Debug, Clone, Deserialize)]
struct OpenAIResponse {
    text: String,
}

pub struct CloudWhisperProvider {
    client: reqwest::Client,
    endpoint_url: String,
    api_key: Option<String>,
    model: String,
}

impl CloudWhisperProvider {
    pub fn new(endpoint_url: String, api_key: Option<String>, model: String) -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .unwrap_or_default();

        Self {
            client,
            endpoint_url,
            api_key,
            model,
        }
    }

    /// Normalizes endpoint URL to ensure it points to /audio/transcriptions
    fn get_full_url(&self) -> String {
        let trimmed = self.endpoint_url.trim().trim_end_matches('/');
        let base_url = if trimmed.is_empty() {
            "https://api.openai.com/v1"
        } else {
            trimmed
        };
        if base_url.ends_with("/audio/transcriptions") {
            base_url.to_string()
        } else if base_url.ends_with("/audio") {
            format!("{}/transcriptions", base_url)
        } else if base_url.ends_with("/v1") {
            format!("{}/audio/transcriptions", base_url)
        } else {
            format!("{}/audio/transcriptions", base_url)
        }
    }
}

/// Helper function to create a 16kHz PCM WAV buffer in memory from f32 audio samples
pub fn create_wav_buffer(samples: &[f32], sample_rate: u32) -> Vec<u8> {
    let num_channels: u16 = 1;
    let bits_per_sample: u16 = 16;
    let byte_rate = sample_rate * num_channels as u32 * (bits_per_sample as u32 / 8);
    let block_align = num_channels * (bits_per_sample / 8);
    let data_size = samples.len() as u32 * (bits_per_sample as u32 / 8);
    let file_size = 36 + data_size;

    let mut buffer = Vec::with_capacity(44 + data_size as usize);

    // RIFF header
    buffer.extend_from_slice(b"RIFF");
    buffer.extend_from_slice(&file_size.to_le_bytes());
    buffer.extend_from_slice(b"WAVE");

    // fmt subchunk
    buffer.extend_from_slice(b"fmt ");
    buffer.extend_from_slice(&16u32.to_le_bytes()); // Subchunk1Size (16 for PCM)
    buffer.extend_from_slice(&1u16.to_le_bytes()); // AudioFormat (1 for PCM)
    buffer.extend_from_slice(&num_channels.to_le_bytes());
    buffer.extend_from_slice(&sample_rate.to_le_bytes());
    buffer.extend_from_slice(&byte_rate.to_le_bytes());
    buffer.extend_from_slice(&block_align.to_le_bytes());
    buffer.extend_from_slice(&bits_per_sample.to_le_bytes());

    // data subchunk
    buffer.extend_from_slice(b"data");
    buffer.extend_from_slice(&data_size.to_le_bytes());

    // PCM samples
    for &sample in samples {
        let clamped = sample.clamp(-1.0, 1.0);
        let i16_sample = (clamped * i16::MAX as f32) as i16;
        buffer.extend_from_slice(&i16_sample.to_le_bytes());
    }

    buffer
}

#[async_trait]
impl TranscriptionProvider for CloudWhisperProvider {
    async fn transcribe(
        &self,
        audio: Vec<f32>,
        language: Option<String>,
    ) -> std::result::Result<TranscriptResult, TranscriptionError> {
        if audio.is_empty() {
            return Err(TranscriptionError::AudioTooShort {
                samples: 0,
                minimum: 1600,
            });
        }

        let wav_data = create_wav_buffer(&audio, 16000);
        let url = self.get_full_url();

        let file_part = multipart::Part::bytes(wav_data)
            .file_name("audio.wav")
            .mime_str("audio/wav")
            .map_err(|e| TranscriptionError::EngineFailed(e.to_string()))?;

        let mut form = multipart::Form::new()
            .part("file", file_part)
            .text("model", self.model.clone());

        if let Some(ref lang) = language {
            if !lang.trim().is_empty() && lang.to_lowercase() != "auto" {
                form = form.text("language", lang.clone());
            }
        }

        let mut request = self.client.post(&url).multipart(form);

        if let Some(ref key) = self.api_key {
            if !key.trim().is_empty() {
                request = request.header("Authorization", format!("Bearer {}", key.trim()));
            }
        }

        info!("Sending Cloud STT request to {} (model: {})", url, self.model);

        let response = request.send().await.map_err(|e| {
            TranscriptionError::EngineFailed(format!("HTTP request failed: {}", e))
        })?;

        let status = response.status();
        let response_text = response.text().await.map_err(|e| {
            TranscriptionError::EngineFailed(format!("Failed to read response: {}", e))
        })?;

        if !status.is_success() {
            error!("Cloud STT API error ({}): {}", status, response_text);
            return Err(TranscriptionError::EngineFailed(format!(
                "API returned error status {}: {}",
                status, response_text
            )));
        }

        let parsed: OpenAIResponse = serde_json::from_str(&response_text).map_err(|e| {
            TranscriptionError::EngineFailed(format!(
                "Failed to parse API response JSON: {}. Response: {}",
                e, response_text
            ))
        })?;

        Ok(TranscriptResult {
            text: parsed.text.trim().to_string(),
            confidence: Some(0.95),
            is_partial: false,
        })
    }

    async fn is_model_loaded(&self) -> bool {
        !self.endpoint_url.trim().is_empty() && !self.model.trim().is_empty()
    }

    async fn get_current_model(&self) -> Option<String> {
        Some(self.model.clone())
    }

    fn provider_name(&self) -> &'static str {
        "Cloud Whisper"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_wav_buffer() {
        let samples = vec![0.0f32, 0.5f32, -0.5f32, 1.0f32, -1.0f32];
        let wav = create_wav_buffer(&samples, 16000);

        // Header size is 44 bytes + 5 samples * 2 bytes = 54 bytes
        assert_eq!(wav.len(), 44 + 5 * 2);
        assert_eq!(&wav[0..4], b"RIFF");
        assert_eq!(&wav[8..12], b"WAVE");
        assert_eq!(&wav[12..16], b"fmt ");
        assert_eq!(&wav[36..40], b"data");
    }

    #[test]
    fn test_get_full_url() {
        let provider = CloudWhisperProvider::new(
            "https://api.openai.com/v1".to_string(),
            None,
            "whisper-1".to_string(),
        );
        assert_eq!(provider.get_full_url(), "https://api.openai.com/v1/audio/transcriptions");

        let provider_transcriptions = CloudWhisperProvider::new(
            "https://api.groq.com/openai/v1/audio/transcriptions".to_string(),
            None,
            "whisper-large-v3-turbo".to_string(),
        );
        assert_eq!(provider_transcriptions.get_full_url(), "https://api.groq.com/openai/v1/audio/transcriptions");
    }
}
