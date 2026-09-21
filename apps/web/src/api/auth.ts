import type {
  AuthState,
  ForgotPasswordInput,
  LoginInput,
  ResetPasswordInput,
} from '@letfer/shared';
import { apiFetch } from './client.js';

export const authApi = {
  me: () => apiFetch<AuthState>('/auth/me'),
  login: (input: LoginInput) => apiFetch<AuthState>('/auth/login', { method: 'POST', body: input }),
  logout: () => apiFetch<void>('/auth/logout', { method: 'POST' }),
  forgotPassword: (input: ForgotPasswordInput) =>
    apiFetch<{ accepted: true }>('/auth/password/forgot', { method: 'POST', body: input }),
  resetPassword: (input: ResetPasswordInput) =>
    apiFetch<void>('/auth/password/reset', { method: 'POST', body: input }),
};
