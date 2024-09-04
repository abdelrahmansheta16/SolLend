import { Connection, clusterApiUrl, PublicKey, Keypair } from '@solana/web3.js';
import { Metaplex, bundlrStorage, keypairIdentity } from '@metaplex-foundation/js';
import { fetchAllDigitalAssetByOwner } from '@metaplex-foundation/mpl-token-metadata'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { irysUploader } from '@metaplex-foundation/umi-uploader-irys'
import { mplCore } from '@metaplex-foundation/mpl-core';

export default async function handler(req, res) {
	console.log(req.body)
	const { address, excludeFilter } = req.body;

	if (req.method !== "POST") {
		res.status(405).send({ message: "Only POST requests allowed" });
		return;
	}

	// Determine the network (Devnet, Testnet, Mainnet)
	const umi = createUmi('https://api.devnet.solana.com').use(mplCore()).use(irysUploader());


	try {
		const publicKey = new PublicKey(address);

		const nfts = await fetchAllDigitalAssetByOwner(umi, publicKey)

		console.log(nfts)
		// Paginate results if pageSize is provided

		const formattedNfts = nfts.map(nft => {
			const metadata = nft.metadata || {};
			console.log(metadata)
			const mintAddress = nft.mint?.publicKey?.toString() || 'Unknown Mint Address';
			const title = metadata.name || 'Untitled';
			const description = metadata.description || 'No description available';
			const metadataURI = metadata.uri || "https://via.placeholder.com/500";

			return {
				contract: mintAddress,
				symbol: metadata.symbol || 'N/A',
				title: title,
				description: description,
				metadataURI,
				tokenId: mintAddress,
				format: "png", // You may want to customize this based on actual data
			};
		});

		if (excludeFilter) {
			const filteredNfts = formattedNfts.filter(
				(nft) => nft.title.length && nft.description.length && nft.media
			);
			if (filteredNfts.length) {
				res.status(200).json({
					nfts: filteredNfts,
					pageKey: null, // Implement your pagination logic here if needed
				});
			} else {
				res.status(200).json({
					nfts: null,
					pageKey: null,
				});
			}
		} else {
			res.status(200).json({
				nfts: formattedNfts.length ? formattedNfts : null,
				pageKey: null, // Implement your pagination logic here if needed
			});
		}
	} catch (e) {
		console.log(e);
		res.status(500).send({
			message: "Something went wrong, check the log in your terminal",
		});
	}
}
