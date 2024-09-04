"use client";
import React, { useState, useEffect } from "react";
import Modal from "react-modal";
import { Connection, PublicKey, SYSVAR_CLOCK_PUBKEY, SystemProgram, Transaction, TransactionInstruction, clusterApiUrl } from '@solana/web3.js';
import * as anchor from "@coral-xyz/anchor";
import BN from 'bn.js';
import { useWallet } from '@solana/wallet-adapter-react';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { mplTokenMetadata, fetchAllDigitalAssetWithTokenByOwner } from '@metaplex-foundation/mpl-token-metadata';
import { publicKey, keypairIdentity } from '@metaplex-foundation/umi';
import { createSignerFromWalletAdapter } from '@metaplex-foundation/umi-signer-wallet-adapters';
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress } from '@solana/spl-token';
import { FiCopy, FiCheck, FiLoader } from 'react-icons/fi';

const PROGRAM_ID = new PublicKey('6aTvYtygQvbXrETCaRVTy2asdQzVf38msbmyPAmb62wz');
const connection = new Connection(clusterApiUrl('devnet'), 'confirmed');
const OFFER_ACCOUNT_SIZE = 8 + 32 + 8 + 8 + 32 + 1 + 32 + 1;

export default function OfferGallery() {
  const wallet = useWallet();
  const [offers, setOffers] = useState([]);
  const [filteredOffers, setFilteredOffers] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedOffer, setSelectedOffer] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingOffer, setLoadingOffer] = useState(null);
  const [loadingBorrow, setLoadingBorrow] = useState(null);
  const [error, setError] = useState(null);
  const [borrowerNFTs, setBorrowerNFTs] = useState([]);
  const [selectedNFT, setSelectedNFT] = useState(null);
  const [nftModalOpen, setNftModalOpen] = useState(false);
  const [nftCurrentPage, setNftCurrentPage] = useState(1);
  const [copiedId, setCopiedId] = useState(null);
  const itemsPerPage = 10;
  const nftItemsPerPage = 9;

  useEffect(() => {
    fetchOffers();
  }, [wallet.publicKey]);

  const fetchOffers = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
        filters: [{ dataSize: OFFER_ACCOUNT_SIZE }],
      });

      const processedOffers = await Promise.all(accounts.map(async ({ pubkey, account }) => {
        const offer = deserializeOffer(account.data, pubkey);
        const collectionId = await fetchCollectionId(offer.collection);
        return {
          ...offer,
          offerPDA: pubkey,
          collectionId: collectionId ? collectionId.toString() : 'Unknown',
          dueDate: calculateDueDate(offer),
        };
      }));

      const availableOffers = processedOffers.filter(offer => !offer.isLoanTaken);
      setOffers(availableOffers);
      setFilteredOffers(availableOffers);
    } catch (err) {
      console.error("Error fetching offers:", err);
      setError("Failed to fetch offers. Please try again later.");
    } finally {
      setIsLoading(false);
    }
  };

  const deserializeOffer = (data, pubkey) => {
    const collection = new PublicKey(data.slice(8, 40));
    const offerLamportAmount = new BN(data.slice(40, 48), 'le');
    const repayLamportAmount = new BN(data.slice(48, 56), 'le');
    const lender = new PublicKey(data.slice(56, 88));
    const isLoanTaken = data[88] === 1;
    const borrower = new PublicKey(data.slice(89, 121));
    const bump = data[121];

    const solAmount = (offerLamportAmount.toNumber() / anchor.web3.LAMPORTS_PER_SOL).toFixed(9);
    const repaymentAmount = (repayLamportAmount.toNumber() / anchor.web3.LAMPORTS_PER_SOL).toFixed(9);

    return {
      collection: collection.toString(),
      solAmount,
      repaymentAmount,
      lender: lender.toString(),
      isLoanTaken,
      borrower: borrower.toString(),
      bump,
    };
  };

  const calculateDueDate = (offer) => {
    // Placeholder implementation
    return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toLocaleDateString();
  };

  const fetchCollectionId = async (collectionPDA) => {
    try {
      const accountInfo = await connection.getAccountInfo(new PublicKey(collectionPDA));
      if (!accountInfo) {
        throw new Error("Collection account not found");
      }
      const collectionId = new PublicKey(accountInfo.data.slice(8, 40));
      return collectionId;
    } catch (error) {
      console.error("Error fetching collection ID:", error);
      return null;
    }
  };

  const handleSearch = (term) => {
    setSearchTerm(term);
    setFilteredOffers(
      offers.filter((offer) =>
        offer.collectionId.toLowerCase().includes(term.toLowerCase())
      )
    );
    setCurrentPage(1);
  };

  const handleSort = (field) => {
    const sortedOffers = [...filteredOffers].sort((a, b) => {
      if (a[field] < b[field]) return -1;
      if (a[field] > b[field]) return 1;
      return 0;
    });
    setFilteredOffers(sortedOffers);
  };

  const handlePageChange = (page) => {
    if (page >= 1 && page <= Math.ceil(filteredOffers.length / itemsPerPage)) {
      setCurrentPage(page);
    }
  };

  const openBorrowModal = async (offer) => {
    setLoadingOffer(offer.offerPDA);
    if (!wallet.publicKey) {
      setError("Please connect your wallet to borrow.");
      return;
    }

    setSelectedOffer(offer);
    const nfts = await fetchBorrowerNFTs(new PublicKey(offer.collectionId));
    if (nfts.length === 0) {
      setError("You don't have any NFTs from this collection to use as collateral.");
    } else {
      setBorrowerNFTs(nfts);
      setNftModalOpen(true);
    }
    setLoadingOffer(null);
  };

  const closeModal = () => {
    setSelectedOffer(null);
    setNftModalOpen(false);
    setSelectedNFT(null);
    setNftCurrentPage(1);
  };

  const handleNFTSelection = (nft) => {
    setSelectedNFT(nft);
  };

  const fetchBorrowerNFTs = async (collectionId) => {
    try {
      if (!wallet.publicKey) {
        setError("Please connect your wallet to borrow.");
        return [];
      }
      // Create a new Umi instance with the correct wallet configuration
      const umi = createUmi(connection)
        .use(mplTokenMetadata())
        .use(keypairIdentity(createSignerFromWalletAdapter(wallet)));

      // Fetch all digital assets owned by the borrower
      const allAssets = await fetchAllDigitalAssetWithTokenByOwner(umi, publicKey(wallet.publicKey.toBase58()));
      console.log(allAssets);

      // Filter assets by the given collection ID and fetch metadata
      const nftsPromises = allAssets
        .filter(asset => asset.metadata.collection?.value?.key === collectionId.toBase58())
        .map(async asset => {
          try {
            // Fetch metadata from the URI
            const response = await fetch(asset.metadata.uri);
            if (!response.ok) {
              throw new Error(`HTTP error! status: ${response.status}`);
            }
            const metadata = await response.json();

            return {
              mint: asset.publicKey,
              name: asset.metadata.name,
              image: metadata.image || asset.metadata.uri, // Use the image URL from metadata if available, otherwise fall back to URI
            };
          } catch (error) {
            console.error(`Error fetching metadata for NFT ${asset.metadata.name}:`, error);
            // Return the asset without the image if metadata fetch fails
            return {
              mint: asset.publicKey,
              name: asset.metadata.name,
              image: asset.metadata.uri,
            };
          }
        });

      const nfts = await Promise.all(nftsPromises);

      console.log(`Found ${nfts.length} NFTs for collection ${collectionId.toBase58()}`);
      return nfts;
    } catch (error) {
      console.error("Error fetching borrower NFTs:", error);
      setError("Failed to fetch your NFTs. Please try again.");
      return [];
    }
  };

  const confirmBorrow = async () => {
    if (!selectedNFT || !selectedOffer || !wallet.publicKey) {
      setError("Please select an NFT as collateral and ensure your wallet is connected.");
      return;
    }

    setLoadingBorrow(true);
    setError(null);

    try {
      const offerIndex = selectedOffer.index;
      const [activeLoanPDA] = await PublicKey.findProgramAddress(
        [Buffer.from("active-loan"), new PublicKey(selectedOffer.offerPDA).toBuffer()],
        PROGRAM_ID
      );

      const [vaultAssetAccountPDA] = await PublicKey.findProgramAddress(
        [Buffer.from("vault-asset-account"), new PublicKey(selectedOffer.offerPDA).toBuffer()],
        PROGRAM_ID
      );

      let [vaultAuth] = await PublicKey.findProgramAddress(
        [new PublicKey(selectedOffer.collection).toBuffer()],
        PROGRAM_ID
      );

      const [vaultAccountPDA] = await PublicKey.findProgramAddress(
        [
          Buffer.from("vault"),
          new PublicKey(selectedOffer.collection).toBuffer(),
          new PublicKey(selectedOffer.lender).toBuffer(),
          new BN(offerIndex).toArrayLike(Buffer, 'le', 8),
        ],
        PROGRAM_ID
      );

      const borrowerAssetAccount = await getAssociatedTokenAddress(
        new PublicKey(selectedNFT.mint),
        wallet.publicKey
      );

      const accountMetas = [
        { pubkey: activeLoanPDA, isSigner: false, isWritable: true },
        { pubkey: selectedOffer.offerPDA, isSigner: false, isWritable: true },
        { pubkey: vaultAccountPDA, isSigner: false, isWritable: true },
        { pubkey: vaultAssetAccountPDA, isSigner: false, isWritable: true },
        { pubkey: vaultAuth, isSigner: false, isWritable: true },
        { pubkey: new PublicKey(selectedOffer.collection), isSigner: false, isWritable: true },
        { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
        { pubkey: borrowerAssetAccount, isSigner: false, isWritable: true },
        { pubkey: new PublicKey(selectedNFT.mint), isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
      ];

      const discriminator = Buffer.from([228, 253, 131, 202, 207, 116, 89, 18]); // Discriminator for "borrow"
      const minimumBalanceForRentExemption = await connection.getMinimumBalanceForRentExemption(41);
      const instructionData = Buffer.concat([
        discriminator,
        new anchor.BN(minimumBalanceForRentExemption).toArrayLike(Buffer, 'le', 8),
      ]);

      const borrowInstruction = new TransactionInstruction({
        keys: accountMetas,
        programId: PROGRAM_ID,
        data: instructionData,
      });

      const transaction = new Transaction().add(borrowInstruction);
      const { blockhash } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = wallet.publicKey;

      const signed = await wallet.signTransaction(transaction);
      const signature = await connection.sendRawTransaction(signed.serialize());
      await connection.confirmTransaction(signature);

      console.log("Borrow transaction successful. Signature:", signature);
      closeModal();
      await fetchOffers();
    } catch (error) {
      console.error("Error during borrowing:", error);
      setError(`Failed to borrow: ${error.message}`);
    } finally {
      setLoadingBorrow(false);
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(text);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  const currentOffers = filteredOffers.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const currentNFTs = borrowerNFTs.slice(
    (nftCurrentPage - 1) * nftItemsPerPage,
    nftCurrentPage * nftItemsPerPage
  );

  const totalPages = Math.ceil(filteredOffers.length / itemsPerPage);
  const totalNFTPages = Math.ceil(borrowerNFTs.length / nftItemsPerPage);

  if (isLoading) {
    return (
      <div className="flex flex-col justify-center items-center h-screen bg-gray-900 text-white w-full">
        <div className="w-16 h-16 border-t-4 border-teal-500 border-solid rounded-full animate-spin mb-4"></div>
        <div className="text-2xl font-bold text-teal-400">Loading Offers</div>
        <div className="text-gray-400 mt-2">Please wait while we fetch the latest lending offers...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col justify-center items-center h-screen bg-gray-900 text-white w-full">
        <div className="bg-red-500 bg-opacity-10 border border-red-500 rounded-lg p-8 max-w-md">
          <div className="flex items-center mb-4">
            <FiAlertTriangle className="text-red-500 text-3xl mr-3" />
            <h2 className="text-2xl font-bold text-red-500">Error</h2>
          </div>
          <p className="text-gray-300 mb-4">{error}</p>
          <button
            onClick={fetchOffers}
            className="bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-4 rounded transition duration-300 ease-in-out"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center bg-gray-900 text-white min-h-screen p-8 w-full">
      <div className="w-full max-w-6xl">
        <h2 className="text-3xl font-bold mb-6 text-teal-400">Explore Lending Offers</h2>
        <div className="flex justify-between items-center mb-6">
          <input
            value={searchTerm}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search by collection ID"
            className="px-4 py-2 rounded-md bg-gray-800 border border-gray-700 text-gray-300 w-64 focus:outline-none focus:ring-2 focus:ring-teal-500 transition duration-300 ease-in-out"
          />
          <div className="flex items-center">
            <label className="mr-2 text-gray-400">Sort by:</label>
            <select
              onChange={(e) => handleSort(e.target.value)}
              className="px-4 py-2 rounded-md bg-gray-800 border border-gray-700 text-gray-300 focus:outline-none focus:ring-2 focus:ring-teal-500 transition duration-300 ease-in-out"
            >
              <option value="collectionId">Collection ID</option>
              <option value="solAmount">SOL Amount</option>
            </select>
          </div>
        </div>

        <div className="bg-gray-800 rounded-lg shadow-xl overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-700">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-teal-400 uppercase tracking-wider">Collection ID</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-teal-400 uppercase tracking-wider">Amount to Borrow</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-teal-400 uppercase tracking-wider">Amount to Repay</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-teal-400 uppercase tracking-wider">Due Date</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-teal-400 uppercase tracking-wider">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {currentOffers.map((offer, index) => (
                <tr key={index} className="hover:bg-gray-750 transition-colors duration-300 ease-in-out">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <span className="font-medium">{offer.collectionId.slice(0, 6)}...{offer.collectionId.slice(-4)}</span>
                      <button
                        onClick={() => copyToClipboard(offer.collectionId)}
                        className="ml-2 text-gray-400 hover:text-teal-400 transition-colors duration-300 ease-in-out"
                      >
                        {copiedId === offer.collectionId ? <FiCheck className="w-4 h-4" /> : <FiCopy className="w-4 h-4" />}
                      </button>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">{offer.solAmount} SOL</td>
                  <td className="px-6 py-4 whitespace-nowrap">{offer.repaymentAmount} SOL</td>
                  <td className="px-6 py-4 whitespace-nowrap">{offer.dueDate}</td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <button
                      onClick={() => openBorrowModal(offer)}
                      className="px-4 py-2 bg-teal-500 text-gray-900 rounded-full hover:bg-teal-400 transition-colors duration-300 ease-in-out transform hover:scale-105"
                    >
                      {loadingOffer === offer.offerPDA ? (
                        <FiLoader className="animate-spin mr-2" />
                      ) : (
                        'Borrow'
                      )}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex justify-center mt-6">
            <button
              onClick={() => handlePageChange(currentPage - 1)}
              disabled={currentPage === 1}
              className={`px-4 py-2 rounded-md ${currentPage === 1 ? "bg-gray-600 cursor-not-allowed" : "bg-teal-500 hover:bg-teal-400"
                } transition-colors duration-300 ease-in-out`}
            >
              Previous
            </button>
            <span className="mx-4 text-lg">Page {currentPage} of {totalPages}</span>
            <button
              onClick={() => handlePageChange(currentPage + 1)}
              disabled={currentPage === totalPages}
              className={`px-4 py-2 rounded-md ${currentPage === totalPages ? "bg-gray-600 cursor-not-allowed" : "bg-teal-500 hover:bg-teal-400"
                } transition-colors duration-300 ease-in-out`}
            >
              Next
            </button>
          </div>
        )}
      </div>

      <Modal
        isOpen={nftModalOpen}
        onRequestClose={closeModal}
        style={{
          content: {
            top: "50%",
            left: "50%",
            right: "auto",
            bottom: "auto",
            marginRight: "-50%",
            transform: "translate(-50%, -50%)",
            backgroundColor: "#1a1a1a",
            borderRadius: "10px",
            padding: "20px",
            color: "#fff",
            width: "90%",
            maxWidth: "600px",
          },
          overlay: {
            backgroundColor: "rgba(0, 0, 0, 0.75)",
          },
        }}
      >
        <h2 className="text-2xl font-bold text-teal-400 mb-4">Select NFT as Collateral</h2>
        <div className="grid grid-cols-3 gap-4">
          {currentNFTs.map((nft, index) => (
            <div
              key={index}
              className={`p-2 border rounded cursor-pointer transition-colors duration-150 ${selectedNFT === nft ? 'border-teal-400 bg-teal-900 bg-opacity-50' : 'border-gray-600 hover:border-teal-400'
                }`}
              onClick={() => handleNFTSelection(nft)}
            >
              <img src={nft.image} alt={nft.name} className="w-full h-32 object-cover mb-2 rounded" />
              <p className="text-sm text-center truncate">{nft.name}</p>
            </div>
          ))}
        </div>
        {totalNFTPages > 1 && (
          <div className="flex justify-center mt-4">
            <button
              onClick={() => setNftCurrentPage(prev => Math.max(prev - 1, 1))}
              disabled={nftCurrentPage === 1}
              className="px-2 py-1 bg-gray-700 rounded mr-2 hover:bg-gray-600 transition-colors duration-150"
            >
              Previous
            </button>
            <span>{nftCurrentPage} / {totalNFTPages}</span>
            <button
              onClick={() => setNftCurrentPage(prev => Math.min(prev + 1, totalNFTPages))}
              disabled={nftCurrentPage === totalNFTPages}
              className="px-2 py-1 bg-gray-700 rounded ml-2 hover:bg-gray-600 transition-colors duration-150"
            >
              Next
            </button>
          </div>
        )}
        <div className="mt-4 flex justify-end">
          <button
            onClick={closeModal}
            className="px-4 py-2 bg-gray-600 rounded-md text-gray-300 hover:bg-gray-500 transition-colors duration-150 mr-2"
          >
            Cancel
          </button>
          <button
            onClick={confirmBorrow}
            disabled={!selectedNFT}
            className={`px-4 py-2 rounded-md ${selectedNFT ? 'bg-teal-500 text-gray-900 hover:bg-teal-400' : 'bg-gray-600 text-gray-400 cursor-not-allowed'
              } transition-colors duration-150`}
          >
            {loadingBorrow ? (
              <FiLoader className="animate-spin mr-2" />
            ) : (
              'Confirm Borrow'
            )}
          </button>
        </div>
      </Modal>
    </div>
  );
}