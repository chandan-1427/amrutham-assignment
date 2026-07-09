import argon2 from 'argon2';

const ARGON2_OPTS = {
  type: argon2.argon2id,
  memoryCost: 19456, // 19 MiB, OWASP baseline
  timeCost: 2,
  parallelism: 1,
};

export const hashPassword = (password: string) => argon2.hash(password, ARGON2_OPTS);
export const verifyPassword = (hash: string, password: string) => argon2.verify(hash, password);