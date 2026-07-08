import { createContext, useContext } from 'react'
import type { User } from '@/types'

interface AuthContextType {
  user: User | null
  isLoading: boolean
  isAdmin: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => void
}

const ADMIN_USER: User = {
  id: '1',
  name: 'Administrador',
  email: 'admin@viscom.com',
  role: 'admin',
  is_active: true,
  created_at: new Date().toISOString(),
}

export const AuthContext = createContext<AuthContextType>({
  user: ADMIN_USER,
  isLoading: false,
  isAdmin: true,
  login: async () => {},
  logout: () => {},
})

export function useAuthState(): AuthContextType {
  return {
    user: ADMIN_USER,
    isLoading: false,
    isAdmin: true,
    login: async () => {},
    logout: () => {},
  }
}

export function useAuth() {
  return useContext(AuthContext)
}
