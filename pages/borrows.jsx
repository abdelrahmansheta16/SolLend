"use client";
import { useRouter } from 'next/navigation';
import React, { useState, useEffect } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey, SystemProgram, Transaction, TransactionInstruction, clusterApiUrl } from '@solana/web3.js';
import BN from 'bn.js';
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress } from '@solana/spl-token';
import { FiAlertCircle, FiCheck, FiCopy } from 'react-icons/fi';

const PROGRAM_ID = new PublicKey('6aTvYtygQvbXrETCaRVTy2asdQzVf38msbmyPAmb62wz');
const connection = new Connection(clusterApiUrl('devnet'), 'confirmed');

class ActiveLoan {
    constructor(buffer) {
        this.collection = new PublicKey(buffer.slice(0, 32));
        this.offerAccount = new PublicKey(buffer.slice(32, 64));
        this.lender = new PublicKey(buffer.slice(64, 96));
        this.borrower = new PublicKey(buffer.slice(96, 128));
        this.mint = new PublicKey(buffer.slice(128, 160));
        this.loanTs = new BN(buffer.slice(160, 168), 'le');
        this.repayTs = new BN(buffer.slice(168, 176), 'le');
        this.isRepaid = buffer[176] !== 0;
        this.isLiquidated = buffer[177] !== 0;
        this.bump = buffer[178];
    }
}

ActiveLoan.LEN = 8 + 32 + 32 + 32 + 32 + 32 + 8 + 8 + 1 + 1 + 1;

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

class Offer {
    constructor(buffer) {
        this.collection = new PublicKey(buffer.slice(0, 32));
        this.offerLamportAmount = new BN(buffer.slice(32, 40), 'le');
        this.repayLamportAmount = new BN(buffer.slice(40, 48), 'le');
        this.lender = new PublicKey(buffer.slice(48, 80));
        this.isLoanTaken = buffer[80] !== 0;
        this.borrower = new PublicKey(buffer.slice(81, 113));
        this.bump = buffer[113];
    }
}

const OrderItem = ({
    collectionId,
    amountSOL,
    createdAt,
    completed,
    isLiquidated,
    repaymentDate,
    onRepay
}) => {
    const [copied, setCopied] = useState(false);

    const statusColors = {
        Completed: 'bg-green-100 text-green-800',
        Active: 'bg-yellow-100 text-yellow-800',
        Liquidated: 'bg-red-100 text-red-800',
    };

    const statusIcons = {
        Completed: <FiCheck className="w-4 h-4" />,
        Active: <FiAlertCircle className="w-4 h-4" />,
        Liquidated: <FiAlertCircle className="w-4 h-4" />,
    };

    const formattedDate = new Date(repaymentDate).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    });

    let status = 'Active';
    if (completed) {
        status = 'Completed';
    } else if (isLiquidated) {
        status = 'Liquidated';
    }

    const copyToClipboard = () => {
        navigator.clipboard.writeText(collectionId);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="flex items-center gap-4 p-4 bg-gray-800 rounded-lg shadow-md transition-all duration-300 hover:bg-gray-750">
            <div className="flex-1 flex items-center">
                <span className="font-medium">{collectionId.slice(0, 6)}...{collectionId.slice(-4)}</span>
                <button
                    onClick={copyToClipboard}
                    className="ml-2 text-gray-400 hover:text-teal-400 transition duration-150"
                >
                    {copied ? <FiCheck className="w-4 h-4" /> : <FiCopy className="w-4 h-4" />}
                </button>
            </div>
            <div className="flex-1 font-semibold text-teal-400">{`${amountSOL.toFixed(4)} SOL`}</div>
            <div className="flex-1 text-sm text-gray-300">{formattedDate}</div>
            <div className="flex-1">
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusColors[status]}`}>
                    {statusIcons[status]}
                    <span className="ml-1">{status}</span>
                </span>
            </div>
            {status === 'Active' && new Date() <= new Date(repaymentDate) ? (
                <div className="flex-1">
                    <button
                        onClick={onRepay}
                        className="px-4 py-2 bg-teal-500 text-gray-900 rounded-full hover:bg-teal-400 transition duration-300"
                    >
                        Repay
                    </button>
                </div>
            ) : <p className="flex-1 text-sm text-gray-300">
                No actions available
            </p>
            }
        </div>
    );
};

const OrderHistoryScreen = () => {
    const router = useRouter();
    const wallet = useWallet();
    const [orderHistories, setOrderHistories] = useState([]);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (wallet.publicKey) {
            fetchBorrowedOffers();
        }
    }, [wallet.publicKey]);

    const fetchBorrowedOffers = async () => {
        if (!wallet.publicKey) {
            console.log("Wallet not connected");
            return;
        }

        setLoading(true);
        setError(null);

        try {
            console.log("Fetching active loans...");
            const activeLoanAccounts = await connection.getProgramAccounts(PROGRAM_ID, {
                filters: [
                    { dataSize: ActiveLoan.LEN },
                    {
                        memcmp: {
                            offset: 8 + 32 + 32 + 32, // Skip discriminator (8) + collection (32) + offerAccount (32) + lender (32)
                            bytes: wallet.publicKey.toBase58()
                        }
                    }
                ],
            });

            console.log(`Found ${activeLoanAccounts.length} active loans for the current wallet`);

            // Group active loans by collection
            const activeLoansByCollection = activeLoanAccounts.reduce((acc, { pubkey, account }) => {
                const activeLoan = new ActiveLoan(account.data.slice(8)); // Skip the 8-byte discriminator
                const collectionKey = activeLoan.collection.toString();

                if (!acc[collectionKey]) {
                    acc[collectionKey] = [];
                }
                acc[collectionKey].push({ activeLoan, pubkey });
                return acc;
            }, {});

            console.log("activeLoansByCollection: ", activeLoansByCollection);

            // Create indexed active loans for each collection with reversed indexing
            const indexedActiveLoans = await Promise.all(
                Object.entries(activeLoansByCollection).flatMap(async ([collection, loans]) => {
                    const reversedIndex = loans.length - 1;
                    return Promise.all(loans.map(async ({ activeLoan, pubkey }, index) => {
                        const offerAccount = await connection.getAccountInfo(activeLoan.offerAccount);
                        if (!offerAccount) {
                            console.log(`Offer account not found for active loan: ${pubkey.toString()}`);
                            return null;
                        }
                        const offerData = new Offer(offerAccount.data.slice(8));

                        // Fetch CollectionPool data to get the collectionId
                        const collectionPoolAccount = await connection.getAccountInfo(activeLoan.collection);
                        if (!collectionPoolAccount) {
                            console.log(`Collection pool not found for active loan: ${pubkey.toString()}`);
                            return null;
                        }
                        const collectionPool = new CollectionPool(collectionPoolAccount.data);

                        return {
                            collectionId: collectionPool.collectionId.toString(),
                            amountSOL: offerData.offerLamportAmount.toNumber() / anchor.web3.LAMPORTS_PER_SOL,
                            createdAt: new Date(activeLoan.loanTs.toNumber() * 1000).toISOString(),
                            completed: activeLoan.isRepaid,
                            repaymentDate: new Date(activeLoan.repayTs.toNumber() * 1000).toISOString(),
                            activeLoanPDA: pubkey,
                            offerPDA: activeLoan.offerAccount,
                            isLiquidated: activeLoan.isLiquidated,
                            lender: activeLoan.lender,
                            mint: activeLoan.mint,
                            index: reversedIndex - index,
                            collectionIndex: `${collectionPool.collectionId.toString()}-${reversedIndex - index}`,
                        };
                    }));
                })
            );

            // Filter out any null values (from offers that weren't found) and sort by creation date
            const validActiveLoans = indexedActiveLoans
                .flat()
                .filter(loan => loan !== null)
                .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

            console.log("Indexed and sorted active loans:", validActiveLoans);

            setOrderHistories(validActiveLoans);
        } catch (error) {
            console.error("Error fetching borrowed offers:", error);
            setError(`Error fetching borrowed offers: ${error.message}`);
        } finally {
            setLoading(false);
        }
    };

    const handleRepay = async (offer) => {
        console.log(offer)
        if (!wallet.publicKey) {
            setError('Please connect your wallet');
            return;
        }

        setLoading(true);
        setError(null);

        try {
            // Derive necessary PDAs
            let [vaultAuth] = await PublicKey.findProgramAddress(
                [new PublicKey(offer.collection).toBuffer()],
                PROGRAM_ID
            );

            const offerIndex = offer.index;
            // Derive vault account PDA
            const [vaultAccountPDA] = await PublicKey.findProgramAddress(
                [
                    Buffer.from("vault"),
                    new PublicKey(offer.collection).toBuffer(),
                    offer.lender.toBuffer(),
                    new BN(offerIndex).toArrayLike(Buffer, 'le', 8),
                ],
                PROGRAM_ID
            );


            const [vaultAssetAccount] = await PublicKey.findProgramAddress(
                [Buffer.from("vault-asset-account"), offer.offerPDA.toBuffer()],
                PROGRAM_ID
            );

            const borrowerAssetAccount = await getAssociatedTokenAddress(
                offer.mint,
                wallet.publicKey
            );

            // Construct the account metas
            const accountMetas = [
                { pubkey: offer.activeLoanPDA, isSigner: false, isWritable: true },
                { pubkey: offer.offerPDA, isSigner: false, isWritable: true },
                { pubkey: new PublicKey(offer.collection), isSigner: false, isWritable: true },
                { pubkey: offer.lender, isSigner: false, isWritable: true },
                { pubkey: offer.mint, isSigner: false, isWritable: true },
                { pubkey: borrowerAssetAccount, isSigner: false, isWritable: true },
                { pubkey: vaultAssetAccount, isSigner: false, isWritable: true },
                { pubkey: vaultAccountPDA, isSigner: false, isWritable: true },
                { pubkey: vaultAuth, isSigner: false, isWritable: true },
                { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
                { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            ];
            console.log(accountMetas)

            // Construct the instruction data with the correct discriminator
            const discriminator = Buffer.from([234, 103, 67, 82, 208, 234, 219, 166]); // Discriminator for "repay"
            const instructionData = discriminator;

            // Create the instruction
            const repayInstruction = new TransactionInstruction({
                keys: accountMetas,
                programId: PROGRAM_ID,
                data: instructionData,
            });

            // Create and send the transaction
            const transaction = new Transaction().add(repayInstruction);
            const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
            transaction.recentBlockhash = blockhash;
            transaction.feePayer = wallet.publicKey;

            const signed = await wallet.signTransaction(transaction);
            const signature = await connection.sendRawTransaction(signed.serialize());

            const confirmation = await connection.confirmTransaction({
                signature,
                blockhash,
                lastValidBlockHeight,
            });

            if (confirmation.value.err) {
                throw new Error('Transaction failed to confirm');
            }

            // Confirm the transaction
            await connection.confirmTransaction(signature, 'confirmed');

            console.log('Loan repaid successfully. Signature:', signature);

            // Update the local state
            setOrderHistories(prevOrders =>
                prevOrders.map(order =>
                    order.activeLoanPDA.equals(offer.activeLoanPDA)
                        ? { ...order, completed: true }
                        : order
                )
            );

        } catch (error) {
            console.error('Error repaying loan:', error);
            setError(`Error repaying loan: ${error.message}`);
        } finally {
            setLoading(false);
        }
    };

    return (
        <main className="flex flex-col justify-center items-center py-16 max-md:py-10 bg-gray-900 text-white min-h-screen">
            <section className="flex flex-col w-full max-w-4xl px-4">
                <header className="flex justify-between items-center mb-8">
                    <h2 className="text-4xl font-bold tracking-tight text-teal-400">
                        My Borrowed Orders
                    </h2>
                    <button
                        onClick={() => router.push("/offers")}
                        className="px-6 py-3 bg-teal-500 text-gray-900 font-semibold rounded-lg hover:bg-teal-400 transition duration-300"
                    >
                        View Available Offers
                    </button>
                </header>
                {error && (
                    <div className="bg-red-500 text-white p-4 rounded-lg mb-4 animate-fade-in flex items-center">
                        <FiAlertCircle className="w-5 h-5 mr-2" />
                        <span>{error}</span>
                    </div>
                )}
                {loading ? (
                    <div className="flex justify-center items-center h-64">
                        <div className="animate-spin rounded-full h-32 w-32 border-t-2 border-b-2 border-teal-500"></div>
                    </div>
                ) : (
                    <div className="bg-gray-800 rounded-lg shadow-xl overflow-hidden">
                        {orderHistories.length > 0 ? (
                            <div className="divide-y divide-gray-700">
                                <div className="grid grid-cols-5 gap-4 px-6 py-3 bg-gray-750 text-sm font-medium text-gray-400 uppercase tracking-wider">
                                    <div>Collection ID</div>
                                    <div>Amount (SOL)</div>
                                    <div>Due Date</div>
                                    <div>Status</div>
                                    <div>Actions</div>
                                </div>
                                <div className="divide-y divide-gray-700">
                                    {orderHistories.map((order, index) => (
                                        <OrderItem
                                            key={index}
                                            {...order}
                                            onRepay={() => handleRepay(order)}
                                        />
                                    ))}
                                </div>
                            </div>
                        ) : (
                            <p className='text-center text-lg py-8 text-gray-400'>No borrowed orders yet</p>
                        )}
                    </div>
                )}
            </section>
        </main>
    );
};

export default OrderHistoryScreen;