import { BrowserRouter, Link, Route, Routes } from 'react-router-dom'
import { AppHeader } from './components/AppHeader.tsx'
import { HomePage } from './pages/HomePage.tsx'
import { RoomPage } from './pages/RoomPage.tsx'
import { AuthProvider } from './state/AuthProvider.tsx'
import { MediaLibraryProvider } from './state/MediaLibraryProvider.tsx'
import { RoomProvider } from './state/RoomProvider.tsx'
import { VideoLibraryProvider } from './state/VideoLibraryProvider.tsx'

function NotFound() {
  return (
    <div className="page page--home">
      <section className="hero hero--compact">
        <h1 className="hero__title">Wala dito.</h1>
        <p className="hero__lead">
          That page does not exist. Head back and start a room.
        </p>
        <Link to="/" className="btn btn--primary btn--lg">
          Back to the videoke
        </Link>
      </section>
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <MediaLibraryProvider>
        <VideoLibraryProvider>
          <RoomProvider>
            <BrowserRouter>
              <AppHeader />
              <main className="app-main">
                <Routes>
                  <Route path="/" element={<HomePage />} />
                  <Route path="/room/:code" element={<RoomPage />} />
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </main>
            </BrowserRouter>
          </RoomProvider>
        </VideoLibraryProvider>
      </MediaLibraryProvider>
    </AuthProvider>
  )
}
