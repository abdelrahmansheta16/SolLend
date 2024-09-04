import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { FiDollarSign, FiBook } from 'react-icons/fi'; // Import icons

export default function Navbar() {
	const router = useRouter();
	const { connection } = useConnection();
	const { publicKey } = useWallet();
	const [balance, setBalance] = useState(null);

	const WalletMultiButtonDynamic = dynamic(
		() => import('@solana/wallet-adapter-react-ui').then((mod) => mod.WalletMultiButton),
		{ ssr: false }
	);

	useEffect(() => {
		if (publicKey) {
			connection.getBalance(publicKey).then(balance => {
				setBalance(balance / LAMPORTS_PER_SOL);
			});
		}
	}, [publicKey, connection]);

	return (
		<nav className="bg-gray-900 text-white shadow-lg">
			<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
				<div className="flex items-center justify-between h-16">
					<div className="flex items-center">
						<a href="/">
							<div className="flex-shrink-0">
								<h1 className="text-2xl font-bold text-teal-400 tracking-wider">
									SolLend
									<span className="text-white text-sm ml-2">NFT Loans</span>
								</h1>
							</div>
						</a>
					</div>
					<div className="flex items-center">
						<button
							onClick={() => router.push("/borrows")}
							className="mx-2 px-4 py-2 bg-gray-800 text-teal-400 rounded-lg hover:bg-gray-700 transition duration-300 ease-in-out flex items-center"
						>
							<FiDollarSign className="mr-2" />
							MY BORROWS
						</button>
						<button
							onClick={() => router.push("/offers")}
							className="mx-2 px-4 py-2 bg-gray-800 text-teal-400 rounded-lg hover:bg-gray-700 transition duration-300 ease-in-out flex items-center"
						>
							<FiBook className="mr-2" />
							MY OFFERS
						</button>
						{typeof window !== 'undefined' && publicKey && (
							<div className="mx-2 px-4 py-2 bg-gray-800 text-teal-400 rounded-lg">
								{balance !== null ? `${balance.toFixed(2)} SOL` : 'Loading...'}
							</div>
						)}
						<div className="ml-2">
							<WalletMultiButtonDynamic />
						</div>
					</div>
				</div>
			</div>
		</nav>
	);
}