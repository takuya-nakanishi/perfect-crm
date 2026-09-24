import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes, useOutletContext } from 'react-router'
import type { MetaResponse } from '@/api/types'
import { ObjectPage } from '@/components/object/ObjectPage'
import { AppShell } from '@/components/shell/AppShell'
import { homePath } from '@/data/queries'
import { Login } from '@/pages/Login'
import { OAuthConsent } from '@/pages/OAuthConsent'

// 環境設定はめったに開かないので、別のファイルにして開くときに読む
const SettingsPage = lazy(() => import('@/pages/settings/SettingsPage').then((m) => ({ default: m.SettingsPage })))
const TablesSettings = lazy(() => import('@/pages/settings/TablesSettings').then((m) => ({ default: m.TablesSettings })))
const FormsSettings = lazy(() => import('@/pages/settings/FormsSettings').then((m) => ({ default: m.FormsSettings })))
const McpSettings = lazy(() => import('@/pages/settings/McpSettings').then((m) => ({ default: m.McpSettings })))

function Home() {
  return <Navigate to={homePath(useOutletContext<MetaResponse>())} replace />
}

function ObjectRoute() {
  return <ObjectPage meta={useOutletContext<MetaResponse>()} />
}

/**
 * 画面の構成:
 *   /login            ログイン
 *   /oauth/consent    Claude のカスタムコネクタから繋ぐときの許可(?request=。サイドバーは出さない)
 *   /o/:objectKey     テーブル(?view= でビュー、?peek=テーブル名:ID で右のパネル)
 *   /settings/…       環境設定(テーブル・Web フォーム・MCP。管理者だけ)
 */
export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/oauth/consent" element={<OAuthConsent />} />
      <Route element={<AppShell />}>
        <Route index element={<Home />} />
        <Route path="/o/:objectKey" element={<ObjectRoute />} />
        <Route
          path="/settings"
          element={
            <Suspense fallback={null}>
              <SettingsPage />
            </Suspense>
          }
        >
          <Route index element={<Navigate to="/settings/tables" replace />} />
          <Route path="tables" element={<Suspense fallback={null}><TablesSettings /></Suspense>} />
          <Route path="forms" element={<Suspense fallback={null}><FormsSettings /></Suspense>} />
          <Route path="mcp" element={<Suspense fallback={null}><McpSettings /></Suspense>} />
        </Route>
        <Route path="*" element={<Home />} />
      </Route>
    </Routes>
  )
}
