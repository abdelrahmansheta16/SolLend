import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { FiDollarSign, FiBook, FiMenu, FiX } from 'react-icons/fi';

export default function Navbar() {
	const router = useRouter();
	const { connection } = useConnection();
	const { publicKey } = useWallet();
	const [balance, setBalance] = useState(null);
	const [isMenuOpen, setIsMenuOpen] = useState(false);

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

	const handleNavigate = (path) => {
		router.push(path);
		setIsMenuOpen(false);
	};

	return (
		<nav className="bg-gray-900 text-white shadow-lg relative z-50">
			<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
				<div className="flex items-center justify-between h-16">
					{/* Logo - always visible */}
					<div className="flex items-center">
						<a href="/" className="flex-shrink-0">
							<h1 className="text-xl sm:text-2xl font-bold text-teal-400 tracking-wider">
								SolLend
								<span className="text-white text-xs sm:text-sm ml-2">NFT Loans</span>
							</h1>
						</a>
					</div>

					{/* Mobile menu button */}
					<div className="flex items-center lg:hidden">
						{typeof window !== 'undefined' && publicKey && (
							<div className="mr-2 px-3 py-1 bg-gray-800 text-teal-400 rounded-lg text-sm">
								{balance !== null ? `${balance.toFixed(2)} SOL` : 'Loading...'}
							</div>
						)}
						<button
							onClick={() => setIsMenuOpen(!isMenuOpen)}
							className="p-2 rounded-md text-gray-400 hover:text-white hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-white"
						>
							{isMenuOpen ? (
								<FiX className="h-6 w-6" />
							) : (
								<FiMenu className="h-6 w-6" />
							)}
						</button>
					</div>

					{/* Desktop menu - hidden on mobile */}
					<div className="hidden lg:flex lg:items-center">
						<button
							onClick={() => handleNavigate("/borrows")}
							className="mx-2 px-4 py-2 bg-gray-800 text-teal-400 rounded-lg hover:bg-gray-700 transition duration-300 ease-in-out flex items-center"
						>
							<FiDollarSign className="mr-2" />
							MY BORROWS
						</button>
						<button
							onClick={() => handleNavigate("/offers")}
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

			{/* Mobile menu - slides down when menu button is clicked */}
			<div
				className={`lg:hidden ${isMenuOpen
					? 'translate-y-0 opacity-100 visible'
					: '-translate-y-full opacity-0 invisible'
					} transform transition-all duration-300 ease-in-out absolute top-16 left-0 right-0 bg-gray-900 shadow-lg`}
			>
				<div className="px-4 pt-2 pb-3 space-y-2">
					<button
						onClick={() => handleNavigate("/borrows")}
						className="w-full px-4 py-2 bg-gray-800 text-teal-400 rounded-lg hover:bg-gray-700 transition duration-300 ease-in-out flex items-center"
					>
						<FiDollarSign className="mr-2" />
						MY BORROWS
					</button>
					<button
						onClick={() => handleNavigate("/offers")}
						className="w-full px-4 py-2 bg-gray-800 text-teal-400 rounded-lg hover:bg-gray-700 transition duration-300 ease-in-out flex items-center"
					>
						<FiBook className="mr-2" />
						MY OFFERS
					</button>
					<div className="px-2 py-2">
						<WalletMultiButtonDynamic />
					</div>
				</div>
			</div>
		</nav>
	);
}