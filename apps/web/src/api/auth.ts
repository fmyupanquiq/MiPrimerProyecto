import type {
  AuthState,
  ForgotPasswordInput,
  LoginInput,
  RegisterInput,
  ResetPasswordInput,
} from '@letfer/shared';
import { apiFetch } from './client.js';

export const authApi = {
  me: () => apiFetch<AuthState>('/auth/me'),
  login: (input: LoginInput) => apiFetch<AuthState>('/auth/login', { method: 'POST', body: input }),
  register: (input: RegisterInput) =>
    apiFetch<AuthState>('/auth/register', { method: 'POST', body: input }),
  reauth: (password: string) =>
    apiFetch<{ reauthenticatedAt: string }>('/auth/reauth', { method: 'POST', body: { password } }),
  logout: () => apiFetch<void>('/auth/logout', { method: 'POST' }),
  forgotPassword: (input: ForgotPasswordInput) =>
    apiFetch<{ accepted: true }>('/auth/password/forgot', { method: 'POST', body: input }),
  resetPassword: (input: ResetPasswordInput) =>
    apiFetch<void>('/auth/password/reset', { method: 'POST', body: input }),
};
