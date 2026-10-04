import fs from 'node:fs/promises';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { randomUUID } from 'node:crypto';

const parseDatabaseUrl=value=>{const url=new URL(value);return {host:url.hostname,port:Number(url.port||3306),user:decodeURIComponent(url.username),password:decodeURIComponent(url.password),database:url.pathname.replace(/^\//,'')}};
const databaseUrl=process.env.DATABASE_URL||process.env.MYSQL_URL||null;
const config=databaseUrl?parseDatabaseUrl(databaseUrl):process.env.DB_HOST
?{host:process.env.DB_HOST,port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME}
:{host:process.env.MYSQLHOST,port:Number(process.env.MYSQLPORT||3306),user:process.env.MYSQLUSER,password:process.env.MYSQLPASSWORD,database:process.env.MYSQLDATABASE};
if(!config.host||!config.user||!config.password||!config.database){console.error('PRICING_CATALOG_IMPORT_FAIL database configuration is incomplete');process.exit(2)}

const catalogPath=path.resolve(process.argv[2]||'pricing/openai-gpt-6-luna-2026-10-04.json');
const catalog=JSON.parse(await fs.readFile(catalogPath,'utf8'));
const db=await mysql.createConnection({...config,charset:'utf8mb4',timezone:'Z'});
const comparable=row=>({
  currency:row.currency,inputRatePerMillion:Number(row.input_rate_per_million),
  cachedInputRatePerMillion:row.cached_input_rate_per_million==null?null:Number(row.cached_input_rate_per_million),
  cacheWriteRatePerMillion:row.cache_write_rate_per_million==null?null:Number(row.cache_write_rate_per_million),
  outputRatePerMillion:Number(row.output_rate_per_million),
  longContextThresholdTokens:row.long_context_threshold_tokens==null?null:Number(row.long_context_threshold_tokens),
  longContextInputRatePerMillion:row.long_context_input_rate_per_million==null?null:Number(row.long_context_input_rate_per_million),
  longContextCachedInputRatePerMillion:row.long_context_cached_input_rate_per_million==null?null:Number(row.long_context_cached_input_rate_per_million),
  longContextCacheWriteRatePerMillion:row.long_context_cache_write_rate_per_million==null?null:Number(row.long_context_cache_write_rate_per_million),
  longContextOutputRatePerMillion:row.long_context_output_rate_per_million==null?null:Number(row.long_context_output_rate_per_million),
  sourceLabel:row.source_label,sourceUri:row.source_uri,formulaVersion:row.formula_version
});
const wanted=tier=>({
  currency:catalog.currency,inputRatePerMillion:Number(tier.inputRatePerMillion),
  cachedInputRatePerMillion:tier.cachedInputRatePerMillion==null?null:Number(tier.cachedInputRatePerMillion),
  cacheWriteRatePerMillion:tier.cacheWriteRatePerMillion==null?null:Number(tier.cacheWriteRatePerMillion),
  outputRatePerMillion:Number(tier.outputRatePerMillion),
  longContextThresholdTokens:tier.longContextThresholdTokens==null?null:Number(tier.longContextThresholdTokens),
  longContextInputRatePerMillion:tier.longContextInputRatePerMillion==null?null:Number(tier.longContextInputRatePerMillion),
  longContextCachedInputRatePerMillion:tier.longContextCachedInputRatePerMillion==null?null:Number(tier.longContextCachedInputRatePerMillion),
  longContextCacheWriteRatePerMillion:tier.longContextCacheWriteRatePerMillion==null?null:Number(tier.longContextCacheWriteRatePerMillion),
  longContextOutputRatePerMillion:tier.longContextOutputRatePerMillion==null?null:Number(tier.longContextOutputRatePerMillion),
  sourceLabel:catalog.sourceLabel,sourceUri:catalog.sourceUri,formulaVersion:'TOKEN_COST_V2'
});

let inserted=0,skipped=0;
try{
  const [targets]=await db.execute(
    `SELECT p.provider_key FROM provider_registry p
     JOIN model_registry m ON m.provider_key=p.provider_key
     WHERE p.adapter_key=? AND p.enabled=TRUE AND m.model_key=? AND m.enabled=TRUE
     ORDER BY p.priority,p.provider_key`,
    [catalog.providerAdapterKey,catalog.modelKey]
  );
  if(!targets.length) console.log(`PRICING_CATALOG_SKIP model_not_registered=${catalog.modelKey}`);
  for(const target of targets){
    for(const tier of catalog.tiers){
      const serviceTier=String(tier.serviceTier).toUpperCase();
      const [existing]=await db.execute(
        `SELECT * FROM pricing_versions WHERE provider_key=? AND model_key=? AND service_tier=? AND effective_from=? LIMIT 1`,
        [target.provider_key,catalog.modelKey,serviceTier,new Date(catalog.effectiveFrom)]
      );
      if(existing.length){
        if(JSON.stringify(comparable(existing[0]))!==JSON.stringify(wanted(tier))){
          const error=new Error(`Immutable pricing conflict for ${target.provider_key}/${catalog.modelKey}/${serviceTier}`);
          error.code='PRICING_CATALOG_CONFLICT';throw error;
        }
        skipped+=1;continue;
      }
      await db.execute(
        `INSERT INTO pricing_versions (
          id,provider_key,model_key,service_tier,currency,
          input_rate_per_million,cached_input_rate_per_million,cache_write_rate_per_million,output_rate_per_million,
          long_context_threshold_tokens,long_context_input_rate_per_million,long_context_cached_input_rate_per_million,
          long_context_cache_write_rate_per_million,long_context_output_rate_per_million,formula_version,
          effective_from,source_label,source_uri,status,metadata_json
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'TOKEN_COST_V2',?,?,?,'ACTIVE',?)`,
        [randomUUID(),target.provider_key,catalog.modelKey,serviceTier,catalog.currency,
         tier.inputRatePerMillion,tier.cachedInputRatePerMillion??null,tier.cacheWriteRatePerMillion??null,tier.outputRatePerMillion,
         tier.longContextThresholdTokens??null,tier.longContextInputRatePerMillion??null,tier.longContextCachedInputRatePerMillion??null,
         tier.longContextCacheWriteRatePerMillion??null,tier.longContextOutputRatePerMillion??null,new Date(catalog.effectiveFrom),
         catalog.sourceLabel,catalog.sourceUri,JSON.stringify(catalog.metadata||null)]
      );
      inserted+=1;
    }
  }
  console.log(`PRICING_CATALOG_IMPORT_PASS model=${catalog.modelKey} inserted=${inserted} skipped=${skipped}`);
}catch(error){
  console.error(`PRICING_CATALOG_IMPORT_FAIL ${error.code||'IMPORT_ERROR'}: ${error.message}`);process.exitCode=1;
}finally{await db.end()}
