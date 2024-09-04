"use client";
import { useRouter } from 'next/navigation';
import React, { useState, useEffect } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey, SystemProgram, Transaction, TransactionInstruction, clusterApiUrl } from '@solana/web3.js';
import BN from 'bn.js';
import { FiCopy, FiCheck } from 'react-icons/fi';

const PROGRAM_ID = new PublicKey('6aTvYtygQvbXrETCaRVTy2asdQzVf38msbmyPAmb62wz');
const connection = new Connection(clusterApiUrl('devnet'), 'confirmed');

class CollectionPool {
    constructor(buffer) {
        this.collectionId = new PublicKey(buffer.slice(8, 40));
        this.poolOwner = new PublicKey(buffer.slice(40, 72));
        this.duration = new BN(buffer.slice(72, 80), 'le').toNumber();
        this.totalOffers = new BN(buffer.slice(80, 88), 'le').toNumber();
        // Note: We're skipping the pool_name as it's a dynamic-length String
        // this.bump is at the end, but we don't need it for this component
    }
}

CollectionPool.LEN = 8 + 32 + 32 + 8 + 8 + 32 + 1;

const AvailableOffersScreen = () => {
    const router = useRouter();
    const wallet = useWallet();
    const [availableOffers, setAvailableOffers] = useState([]);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(false);
    const [copiedId, setCopiedId] = useState(null);

    useEffect(() => {
        if (wallet.publicKey) {
            fetchAvailableOffers();
        }
    }, [wallet.publicKey]);

    const fetchAvailableOffers = async () => {
        if (!wallet.publicKey) {
            console.log("Wallet not connected");
            return;
        }

        setLoading(true);
        setError(null);

        try {
            console.log("Fetching available offers...");
            const offerAccounts = await connection.getProgramAccounts(PROGRAM_ID, {
                filters: [
                    { dataSize: 8 + 32 + 8 + 8 + 32 + 1 + 32 + 1 }, // Offer account size
                    {
                        memcmp: {
                            offset: 8 + 32 + 8 + 8, // Skip discriminator (8) + collection (32) + offerLamportAmount (8) + repayLamportAmount (8)
                            bytes: wallet.publicKey.toBase58()
                        }
                    }
                ],
            });

            console.log(`Found ${offerAccounts.length} offers for the current wallet`);

            const offers = await Promise.all(offerAccounts.map(async ({ pubkey, account }) => {
                const offer = deserializeOffer(account.data, pubkey);

                // Fetch the collection pool account directly using the offer's collection field
                const collectionPoolAccount = await connection.getAccountInfo(offer.collection);

                if (!collectionPoolAccount) {
                    console.error(`Collection pool not found for offer: ${pubkey.toBase58()}`);
                    return null;
                }

                const collectionPool = new CollectionPool(collectionPoolAccount.data);

                // Calculate due date
                const currentTime = Math.floor(Date.now() / 1000);
                const dueDate = new Date((currentTime + collectionPool.duration) * 1000);

                return {
                    ...offer,
                    collectionId: collectionPool.collectionId.toString(),
                    dueDate: dueDate.toLocaleDateString(),
                };
            }));

            const validOffers = offers.filter(offer => offer !== null && !offer.isLoanTaken);

            console.log("Valid available offers:", validOffers);
            setAvailableOffers(validOffers);
        } catch (err) {
            console.error("Error fetching offers:", err);
            setError("Failed to fetch offers. Please try again later.");
        } finally {
            setLoading(false);
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
            collection,
            solAmount,
            repaymentAmount,
            lender: lender.toString(),
            isLoanTaken,
            borrower: borrower.toString(),
            bump,
            offerPDA: pubkey,
        };
    };
    const handleWithdraw = async (offer) => {
        console.log(offer)
        if (!wallet.publicKey) {
            setError('Please connect your wallet');
            return;
        }

        setLoading(true);
        setError(null);

        try {
            const instructionData = Buffer.concat([
                Buffer.from([203, 38, 131, 234, 204, 122, 53, 150]), // withdraw_offer instruction discriminator
                new BN(await connection.getMinimumBalanceForRentExemption(0)).toArrayLike(Buffer, 'le', 8)
            ]);
            const offerIndex = offer.index;
            const [vaultAccountPDA] = await PublicKey.findProgramAddress(
                [
                    Buffer.from("vault"),
                    new PublicKey(offer.collection).toBuffer(),
                    new PublicKey(offer.lender).toBuffer(),
                    new BN(offerIndex).toArrayLike(Buffer, 'le', 8),
                ],
                PROGRAM_ID
            );
            const withdrawInstruction = new TransactionInstruction({
                keys: [
                    { pubkey: offer.offerPDA, isSigner: false, isWritable: true },
                    { pubkey: vaultAccountPDA, isSigner: false, isWritable: true },
                    { pubkey: new PublicKey(offer.collection), isSigner: false, isWritable: true },
                    { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
                    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
                ],
                programId: PROGRAM_ID,
                data: instructionData,
            });

            const transaction = new Transaction().add(withdrawInstruction);
            const { blockhash } = await connection.getLatestBlockhash();
            transaction.recentBlockhash = blockhash;
            transaction.feePayer = wallet.publicKey;

            const signed = await wallet.signTransaction(transaction);
            const signature = await connection.sendRawTransaction(signed.serialize());
            await connection.confirmTransaction(signature, 'confirmed');

            console.log('Withdrawal successful. Signature:', signature);

            // Remove the withdrawn offer from the local state
            setAvailableOffers(prevOffers =>
                prevOffers.filter(o => !o.offerPDA.equals(offer.offerPDA))
            );
        } catch (error) {
            console.error('Error withdrawing offer:', error);
            setError(`Error withdrawing offer: ${error.message}`);
        } finally {
            setLoading(false);
        }
    };


    const copyToClipboard = (text) => {
        navigator.clipboard.writeText(text).then(() => {
            setCopiedId(text);
            setTimeout(() => setCopiedId(null), 2000);
        });
    };

    return (
        <main className="flex flex-col justify-center items-center py-16 max-md:py-10 bg-gray-900 text-white min-h-screen">
            <section className="flex flex-col w-full max-w-6xl px-4">
                <header className="flex justify-between items-center mb-8">
                    <h2 className="text-4xl font-bold tracking-tight text-teal-400">
                        Available Offers
                    </h2>
                    <div className="flex space-x-4">
                        <button
                            onClick={() => router.push("/create-offer")}
                            className="px-6 py-3 bg-teal-500 text-gray-900 font-semibold rounded-lg hover:bg-teal-400 transition duration-300"
                        >
                            CREATE OFFER
                        </button>
                        <button
                            onClick={() => router.push("/active-offers")}
                            className="px-6 py-3 bg-blue-500 text-gray-900 font-semibold rounded-lg hover:bg-blue-400 transition duration-300"
                        >
                            VIEW ACTIVE LOANS
                        </button>
                    </div>
                </header>
                {error && (
                    <div className="bg-red-500 text-white p-4 rounded-lg mb-4 animate-fade-in">
                        {error}
                    </div>
                )}
                {loading ? (
                    <div className="flex justify-center items-center h-64">
                        <div className="animate-spin rounded-full h-32 w-32 border-t-2 border-b-2 border-teal-500"></div>
                    </div>
                ) : (
                    <div className="bg-gray-800 rounded-lg shadow-xl overflow-hidden">
                        <table className="w-full">
                            <thead className="bg-gray-700">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-teal-400 uppercase tracking-wider">Collection ID</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-teal-400 uppercase tracking-wider">Offer Amount (SOL)</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-teal-400 uppercase tracking-wider">Repayment Amount (SOL)</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-teal-400 uppercase tracking-wider">Due Date</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-teal-400 uppercase tracking-wider">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-700">
                                {availableOffers.length > 0 ? (
                                    availableOffers.map((offer, index) => (
                                        <tr key={index} className="hover:bg-gray-750 transition duration-150">
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <div className="flex items-center">
                                                    <span className="font-medium">{offer.collectionId.slice(0, 6)}...{offer.collectionId.slice(-4)}</span>
                                                    <button
                                                        onClick={() => copyToClipboard(offer.collectionId)}
                                                        className="ml-2 text-gray-400 hover:text-teal-400 transition duration-150"
                                                    >
                                                        {copiedId === offer.collectionId ? <FiCheck /> : <FiCopy />}
                                                    </button>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">{offer.solAmount}</td>
                                            <td className="px-6 py-4 whitespace-nowrap">{offer.repaymentAmount}</td>
                                            <td className="px-6 py-4 whitespace-nowrap">{offer.dueDate}</td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <button
                                                    onClick={() => handleWithdraw(offer)}
                                                    className="px-4 py-2 bg-red-500 text-gray-900 rounded-full hover:bg-red-400 transition duration-300"
                                                >
                                                    Withdraw
                                                </button>
                                            </td>
                                        </tr>
                                    ))
                                ) : (
                                    <tr>
                                        <td colSpan="5" className="px-6 py-4 text-center text-gray-400">
                                            No available offers found
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>
        </main>
    );
};

export default AvailableOffersScreen;