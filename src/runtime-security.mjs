import { timingSafeEqual } from 'node:crypto';
import { authenticateScopedToken } from './runtime-iam.mjs';

const errorOf = (message, code, statusCode) => {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
};

const safeEqual = (leftValue, rightValue) => {
  const left = Buffer.from(String(leftValue || ''), 'utf8');
  const right = Buffer.from(String(rightValue || ''), 'utf8');
  if (!left.length || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
};

export const runtimeAuthRequired = () => {
  const configured = String(process.env.RUNTIME_REQUIRE_AUTH || '').toLowerCase();
  if (configured === 'false') return false;
  if (configured === 'true') return true;
  return String(process.env.NODE_ENV || '').toLowerCase() === 'production';
};

export const assertRuntimeSecurityConfig = () => {
  if (runtimeAuthRequired() && !process.env.RUNTIME_API_TOKEN) {
    throw errorOf(
      'RUNTIME_REQUIRE_AUTH=true but RUNTIME_API_TOKEN is missing',
      'RUNTIME_SECURITY_NOT_CONFIGURED',
      503
    );
  }
};

export const authorizeRuntimeRequest = async req => {
  if (!runtimeAuthRequired()) {
    return {authType:'AUTH_DISABLED',platformAdmin:true,permissions:['*']};
  }
  assertRuntimeSecurityConfig();

  const header = String(req.headers.authorization || '');
  const prefix = 'Bearer ';
  const token = header.startsWith(prefix) ? header.slice(prefix.length) : '';
  if (!token) throw errorOf('Runtime API authentication failed', 'RUNTIME_UNAUTHORIZED', 401);

  if (safeEqual(token, process.env.RUNTIME_API_TOKEN)) {
    return {authType:'PLATFORM_TOKEN',platformAdmin:true,permissions:['*']};
  }

  const scoped=await authenticateScopedToken(token);
  if(!scoped) throw errorOf('Runtime API authentication failed', 'RUNTIME_UNAUTHORIZED', 401);
  return scoped;
};
