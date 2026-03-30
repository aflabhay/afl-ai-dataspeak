import Head     from 'next/head';
import ChatWindow from '../components/ChatWindow';
import AuthGate   from '../components/AuthGate';

export default function Home() {
  return (
    <>
      <Head>
        <title>AIDA — Arvind Intelligent Data Assistant</title>
        <meta name="description" content="Ask questions about your AFL data in plain English" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <AuthGate>
        <ChatWindow />
      </AuthGate>
    </>
  );
}
