// forge module barrel — other modules import it only through this file. The GitHub adapters
// themselves live in connectors/github/ now; this module keeps the per-repo resolver wiring
// until the connector registry replaces it.
export * from './repo-forge-resolver';
export * from './repo-tracker-resolver';
