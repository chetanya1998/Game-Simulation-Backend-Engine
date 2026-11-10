import { SCHEMA_VERSION } from '@gamex/model';

/** Version of the simulation engine; recorded in every run record for reproducibility. */
export const ENGINE_VERSION = '0.1.0';

/** The Game Model schema version this engine build reads. */
export const SUPPORTED_SCHEMA_VERSION: string = SCHEMA_VERSION;
