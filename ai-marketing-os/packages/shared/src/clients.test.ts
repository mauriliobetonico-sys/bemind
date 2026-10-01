import { describe, expect, it } from 'vitest';
import { createClientInput, isValidCnpj } from './schemas/clients';
import { SYSTEM_ROLES } from './permissions';

describe('isValidCnpj', () => {
  it('aceita CNPJ válido', () => {
    expect(isValidCnpj('11222333000181')).toBe(true);
  });
  it('rejeita dígitos verificadores errados e sequências repetidas', () => {
    expect(isValidCnpj('11222333000180')).toBe(false);
    expect(isValidCnpj('11111111111111')).toBe(false);
    expect(isValidCnpj('123')).toBe(false);
  });
});

describe('createClientInput', () => {
  const base = {
    legalName: 'Empresa Exemplo LTDA',
    tradeName: 'Exemplo',
    responsibleName: 'Ana Souza',
    email: 'ANA@EXEMPLO.COM.BR ',
    plan: 'PRO',
    monthlyFeeCents: 350000,
  };

  it('normaliza e-mail e CNPJ e aplica padrões', () => {
    const parsed = createClientInput.parse({ ...base, cnpj: '11.222.333/0001-81' });
    expect(parsed.email).toBe('ana@exemplo.com.br');
    expect(parsed.cnpj).toBe('11222333000181');
    expect(parsed.status).toBe('onboarding');
    expect(parsed.inviteUser).toBe(true);
  });

  it('rejeita campos desconhecidos (ex.: tenantId injetado pelo frontend)', () => {
    const result = createClientInput.safeParse({ ...base, tenantId: '00000000-0000-0000-0000-000000000000' });
    expect(result.success).toBe(false);
  });
});

describe('SYSTEM_ROLES', () => {
  it('CLIENTE nunca recebe permissões administrativas', () => {
    const cliente = SYSTEM_ROLES.find((r) => r.key === 'CLIENTE')!;
    for (const p of ['tenants:manage', 'users:manage', 'users:read', 'audit:read', 'dashboard:admin', 'clients:write']) {
      expect(cliente.permissions).not.toContain(p);
    }
  });
});
