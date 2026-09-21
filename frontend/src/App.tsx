import { Navigate, Route, Routes, useOutletContext } from 'react-router'
import type { MetaResponse } from '@/api/types'
import { ObjectPage } from '@/components/object/ObjectPage'
import { AppShell } from '@/components/shell/AppShell'
import { homePath } from '@/data/queries'
import { Login } from '@/pages/Login'

function Home() {
  return <Navigate to={homePath(useOutletContext<MetaResponse>())} replace />
}

function ObjectRoute() {
  return <ObjectPage meta={useOutletContext<MetaResponse>()} />
}

/**
 * 画面の構成:
 *   /login            ログイン
 *   /o/:objectKey     テーブル(?view= でビュー、?peek=テーブル名:ID で右のパネル)
 */
export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<AppShell />}>
        <Route index element={<Home />} />
        <Route path="/o/:objectKey" element={<ObjectRoute />} />
        <Route path="*" element={<Home />} />
      </Route>
    </Routes>
  )
}
