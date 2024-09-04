import '../styles/globals.css';
import '@solana/wallet-adapter-react-ui/styles.css';

import { WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-wallets';
import { ConnectionProvider } from '@solana/wallet-adapter-react';
import MainLayout from '../layout/mainLayout';
import { useEffect, useState } from 'react';

function MyApp({ Component, pageProps }) {
	const [network, setNetwork] = useState('devnet'); // Default to devnet

	useEffect(() => {
		const savedNetwork = localStorage.getItem('solana-network');
		if (savedNetwork) {
			setNetwork(savedNetwork);
		}
	}, []);

	useEffect(() => {
		localStorage.setItem('solana-network', network);
	}, [network]);

	const getRpcUrl = (network) => {
		switch (network) {
			case 'mainnet-beta':
				return process.env.NEXT_PUBLIC_SOLANA_MAINNET_RPC_URL;
			case 'testnet':
				return process.env.NEXT_PUBLIC_SOLANA_TESTNET_RPC_URL;
			case 'devnet':
			default:
				return process.env.NEXT_PUBLIC_SOLANA_DEVNET_RPC_URL;
		}
	};

	const endpoint = getRpcUrl(network);

	const wallets = [new PhantomWalletAdapter()];

	return (
		<>
			<head>
				<title>SolLend</title>
				<link rel="icon" href="/favicon.ico" />
			</head>
			<html lang="en">
				<body className={`${space.className}`}>
					<ConnectionProvider endpoint={endpoint}>
						<WalletProvider wallets={wallets} autoConnect>
							<WalletModalProvider>
								<MainLayout>
									<Component
										{...pageProps}
										network={network}
										setNetwork={setNetwork}
									/>
								</MainLayout>
							</WalletModalProvider>
						</WalletProvider>
					</ConnectionProvider>
				</body>
			</html>
		</>
	);
}

export default MyApp;
