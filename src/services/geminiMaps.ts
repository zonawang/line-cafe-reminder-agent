import { GoogleGenAI, type GenerateContentResponse } from '@google/genai';

import { env } from '../utils/env.js';
import { logger } from '../utils/logger.js';

export type Cafe = {
  title: string;
  uri: string;
};

export type CafeSearchResult = {
  summary: string;
  cafes: Cafe[];
};

const ai = new GoogleGenAI({
  enterprise: true,
  project: env.GOOGLE_CLOUD_PROJECT,
  location: env.GOOGLE_CLOUD_LOCATION,
  apiVersion: 'v1'
});

function collectCafes(response: GenerateContentResponse): Cafe[] {
  const candidates =
    response.candidates?.flatMap((candidate) =>
      (candidate.groundingMetadata?.groundingChunks ?? []).flatMap((chunk) => {
        const maps = chunk.maps;
        if (!maps?.uri || !/^https:\/\//u.test(maps.uri)) return [];
        return [{
          title: maps.title?.trim() || 'Google Maps 地點',
          uri: maps.uri,
          placeId: maps.placeId
        }];
      })
    ) ?? [];

  const unique = new Map<string, Cafe & { isReview: boolean }>();
  for (const candidate of candidates) {
    const isReview = /^Review of /iu.test(candidate.title);
    const title = candidate.title
      .replace(/^Review of /iu, '')
      .replace(/ - Google Maps$/iu, '')
      .trim();
    const key = candidate.placeId || title.toLocaleLowerCase('en-US') || candidate.uri;
    const existing = unique.get(key);
    if (!existing || (existing.isReview && !isReview)) {
      unique.set(key, { title: title || 'Google Maps 地點', uri: candidate.uri, isReview });
    }
  }

  return Array.from(unique.values(), ({ title, uri }) => ({ title, uri })).slice(0, 5);
}

function clean(text: string): string {
  return text.replace(/\n{3,}/gu, '\n\n').trim().slice(0, 3500);
}

async function translate(text: string): Promise<string> {
  try {
    const response = await ai.models.generateContent({
      model: env.GEMINI_TRANSLATION_MODEL,
      contents: [
        'Translate these grounded cafe recommendations into natural Traditional Chinese used in Taiwan.',
        'Preserve place names, numbers, caveats, and facts. Add no facts or URLs. Return only the translation.',
        '',
        text
      ].join('\n')
    });
    return clean(response.text || text);
  } catch (error) {
    logger.error('Gemini translation failed; using English fallback', {
      error: error instanceof Error ? error.message : String(error)
    });
    return clean(text);
  }
}

export async function findNearbyCafes(
  latitude: number,
  longitude: number
): Promise<CafeSearchResult> {
  const response = await ai.models.generateContent({
    model: env.GEMINI_MAPS_MODEL,
    contents: [
      'Find 3 to 5 good cafes near the supplied user location.',
      'For each, state its exact name, why it is a good choice, and useful facts supported by Google Maps.',
      'Do not invent outlet, Wi-Fi, time-limit, or noise information. Keep it concise and respond in English.'
    ].join(' '),
    config: {
      tools: [{ googleMaps: {} }],
      toolConfig: {
        retrievalConfig: {
          latLng: { latitude, longitude },
          languageCode: 'en_US'
        }
      }
    }
  });

  const raw = clean(response.text || '');
  const cafes = collectCafes(response);
  if (!raw || cafes.length === 0) throw new Error('Gemini Maps returned no usable cafes');
  return { summary: await translate(raw), cafes };
}

export const geminiMapsInternals = { collectCafes };
