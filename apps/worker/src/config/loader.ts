/**
 * Segment Config Loader
 *
 * Loads segment configuration from Supabase Storage.
 * Config is stored as JSON in a storage bucket for easy updates without deploys.
 */

import { SegmentConfigFileSchema } from '@corridor/shared';
import type { SegmentConfig, SegmentConfigFile } from '@corridor/shared';

/**
 * Config loader options
 */
type ConfigLoaderOptions = {
  supabaseUrl: string;
  supabaseServiceKey: string;
  bucketName?: string;
  configPath?: string;
};

/**
 * Config loader result
 */
type ConfigLoaderResult = {
  segments: SegmentConfig[];
  version: string;
};

/**
 * Config loader interface
 */
export type ConfigLoader = {
  loadSegments: () => Promise<ConfigLoaderResult>;
};

/**
 * Create a config loader for Supabase Storage
 *
 * @param options Configuration options including Supabase credentials
 * @returns ConfigLoader instance
 */
export const createConfigLoader = (options: ConfigLoaderOptions): ConfigLoader => {
  const {
    supabaseUrl,
    supabaseServiceKey,
    bucketName = 'config',
    configPath = 'segments.v1.json',
  } = options;

  /**
   * Load segments from Supabase Storage
   */
  const loadSegments = async (): Promise<ConfigLoaderResult> => {
    // Build the storage URL
    // Supabase Storage URL format: {supabaseUrl}/storage/v1/object/{bucket}/{path}
    const storageUrl = `${supabaseUrl}/storage/v1/object/${bucketName}/${configPath}`;

    const response = await fetch(storageUrl, {
      headers: {
        Authorization: `Bearer ${supabaseServiceKey}`,
        apikey: supabaseServiceKey,
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(
          `Config file not found: ${bucketName}/${configPath}. ` +
            'Upload segments.v1.json to Supabase Storage.'
        );
      }
      throw new Error(
        `Failed to load config: ${response.status} ${response.statusText}`
      );
    }

    const rawData = await response.json();

    // Validate with Zod schema
    const parseResult = SegmentConfigFileSchema.safeParse(rawData);

    if (!parseResult.success) {
      throw new Error(
        `Invalid config file format: ${parseResult.error.message}`
      );
    }

    const config: SegmentConfigFile = parseResult.data;

    console.log(
      `  Loaded ${config.segments.length} segments from config v${config.version}`
    );

    return {
      segments: config.segments,
      version: config.version,
    };
  };

  return { loadSegments };
};
