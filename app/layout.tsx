import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { AppLanguage, LanguageBootstrap, LanguageProvider } from './language';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Local Video Workspace',
  description: 'A local-first video editing workspace for people and their bots.',
  openGraph: { title: 'Local Video Workspace', description: 'A local-first video editing workspace for people and their bots.' },
  twitter: { card: 'summary', title: 'Local Video Workspace', description: 'A local-first video editing workspace for people and their bots.' },
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const cookieStore = await cookies();
  const initialLanguage: AppLanguage = cookieStore.get('localVideoWorkspaceLanguage')?.value === 'en' ? 'en' : 'ko';
  const migrateStoredLanguage = `(function(){try{var saved=localStorage.getItem('localVideoWorkspaceLanguage');if((saved==='ko'||saved==='en')&&document.cookie.indexOf('localVideoWorkspaceLanguage=')===-1){document.cookie='localVideoWorkspaceLanguage='+saved+'; path=/; max-age=31536000; samesite=lax';location.replace(location.href);}}catch(e){}})();`;
  return <html lang={initialLanguage}><head><script dangerouslySetInnerHTML={{ __html: migrateStoredLanguage }} /></head><body className={`${geistSans.variable} ${geistMono.variable}`}><LanguageProvider initialLanguage={initialLanguage}><LanguageBootstrap />{children}</LanguageProvider></body></html>;
}
