// frontend/pages/index.jsx
import Head        from 'next/head';
import ChatWindow  from '../components/ChatWindow';

export default function Home() {
  return (
    <>
      <Head>
        <title>Data Analytics Assistant</title>
        <meta name="description" content="Chat with your BigQuery and Fabric data using GPT-4o-mini" />
      </Head>
      <main>
        <ChatWindow />
      </main>
    </>
  );
}
