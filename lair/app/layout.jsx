import './persona.css';
import './globals.css';
import './deck.css';
import './responsive.css';

export const metadata = {
  description: 'The dragon\'s lair: overview, workflows, agents, news, the Hoard, approvals, operations.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: "try{var s=localStorage,t=s.getItem('aeryx.theme')||s.getItem('aeryx.persona');if(t==='aeri'||t==='violet')document.documentElement.dataset.persona=t}catch(e){}" }} />
      </head>
      <body>
        {children}
        <script src="/orb.js" defer></script>
      </body>
    </html>
  );
}
