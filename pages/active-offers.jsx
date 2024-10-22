"use client";
import { useRouter } from 'next/navigation';
import React, { useState, useEffect } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey, SystemProgram, Transaction, TransactionInstruction, clusterApiUrl, SYSVAR_CLOCK_PUBKEY } from '@solana/web3.js';
import BN from 'bn.js';
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress, createAssociatedTokenAccount, createAssociatedTokenAccountInstruction } from '@solana/spl-token';

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

const LoanCard = ({ loan, onLiquidate }) => {
    const statusConfig = {
        Active: { color: 'text-green-400', bgColor: 'bg-green-400 bg-opacity-10' },
        Liquidated: { color: 'text-red-400', bgColor: 'bg-red-400 bg-opacity-10' },
        Repaid: { color: 'text-blue-400', bgColor: 'bg-blue-400 bg-opacity-10' },
    };

    const { color, bgColor } = statusConfig[loan.status] || statusConfig.Active;
    const isLiquidatable = loan.status === 'Active' && Date.now() > loan.repayTs.toNumber() * 1000;

    return (
        <div className="bg-gray-800 p-4 rounded-lg border border-gray-700">
            <div className="grid grid-cols-2 gap-3 mb-4">
                <div>
                    <p className="text-xs text-gray-400 mb-1">Collection</p>
                    <p className="text-sm font-medium">{loan.collection.toBase58().slice(0, 6)}...</p>
                </div>
                <div>
                    <p className="text-xs text-gray-400 mb-1">Borrower</p>
                    <p className="text-sm font-medium">{loan.borrower.toBase58().slice(0, 6)}...</p>
                </div>
                <div>
                    <p className="text-xs text-gray-400 mb-1">Repayment Date</p>
                    <p className="text-sm font-medium">
                        {new Date(loan.repayTs.toNumber() * 1000).toLocaleDateString()}
                    </p>
                </div>
                <div>
                    <p className="text-xs text-gray-400 mb-1">Status</p>
                    <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${color} ${bgColor}`}>
                        {loan.status}
                    </span>
                </div>
            </div>
            {isLiquidatable && (
                <div className="mt-3 flex justify-end">
                    <button
                        onClick={() => onLiquidate(loan)}
                        className="px-4 py-2 bg-red-500 text-gray-900 text-sm rounded-full hover:bg-red-400 transition-colors duration-300"
                    >
                        Liquidate
                    </button>
                </div>
            )}
        </div>
    );
};

const ActiveLoansScreen = () => {
    const router = useRouter();
    const wallet = useWallet();
    const [loans, setLoans] = useState([]);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (wallet.publicKey) {
            fetchLoans();
        }
    }, [wallet.publicKey]);

    const fetchLoans = async () => {
        if (!wallet.publicKey) {
            console.log("Wallet not connected");
            return;
        }

        setLoading(true);
        setError(null);

        try {
            const loanAccounts = await connection.getProgramAccounts(PROGRAM_ID, {
                filters: [
                    { dataSize: ActiveLoan.LEN },
                    {
                        memcmp: {
                            offset: 8 + 32 + 32, // offset for lender
                            bytes: wallet.publicKey.toBase58(),
                        },
                    },
                ],
            });

            const loans = loanAccounts.map(({ pubkey, account }) => {
                const loan = new ActiveLoan(account.data.slice(8)); // Skip 8-byte discriminator
                return {
                    ...loan,
                    activeLoanPDA: pubkey,
                    status: loan.isRepaid ? 'Repaid' : (loan.isLiquidated ? 'Liquidated' : 'Active'),
                };
            });

            setLoans(loans);
        } catch (error) {
            console.error("Error fetching loans:", error);
            setError(`Error fetching loans: ${error.message}`);
        } finally {
            setLoading(false);
        }
    };

    const handleLiquidate = async (loan) => {
        console.log(loan)
        if (!wallet.publicKey) {
            setError('Please connect your wallet');
            return;
        }

        setLoading(true);
        setError(null);

        try {
            const [vaultAssetAccountPDA] = await PublicKey.findProgramAddress(
                [Buffer.from("vault-asset-account"), loan.offerAccount.toBuffer()],
                PROGRAM_ID
            );

            const [vaultAuthorityPDA] = await PublicKey.findProgramAddress(
                [loan.collection.toBuffer()],
                PROGRAM_ID
            );

            const lenderAssetAccount = await getAssociatedTokenAddress(
                loan.mint,
                wallet.publicKey
            );

            const lenderAccountInfo = await connection.getAccountInfo(lenderAssetAccount);
            const transaction = new Transaction();
            if (!lenderAccountInfo) {
                // If it doesn't exist, add instruction to create it
                console.log("Creating lender's associated token account");
                transaction.add(
                    createAssociatedTokenAccountInstruction(
                        wallet.publicKey,
                        lenderAssetAccount,
                        wallet.publicKey,
                        loan.mint
                    )
                );
            }

            console.log(lenderAssetAccount.toBase58());
            const liquidateInstruction = new TransactionInstruction({
                keys: [
                    { pubkey: loan.activeLoanPDA, isSigner: false, isWritable: true },
                    { pubkey: loan.offerAccount, isSigner: false, isWritable: true },
                    { pubkey: loan.collection, isSigner: false, isWritable: true },
                    { pubkey: loan.mint, isSigner: false, isWritable: true },
                    { pubkey: vaultAssetAccountPDA, isSigner: false, isWritable: true },
                    { pubkey: lenderAssetAccount, isSigner: false, isWritable: true },
                    { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
                    { pubkey: vaultAuthorityPDA, isSigner: false, isWritable: true },
                    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
                    { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
                ],
                programId: PROGRAM_ID,
                data: Buffer.from([223, 179, 226, 125, 48, 46, 39, 74]), // liquidate instruction discriminator
            });

            transaction.add(liquidateInstruction);
            const { blockhash } = await connection.getLatestBlockhash();
            transaction.recentBlockhash = blockhash;
            transaction.feePayer = wallet.publicKey;

            const signed = await wallet.signTransaction(transaction);
            const signature = await connection.sendRawTransaction(signed.serialize());
            await connection.confirmTransaction(signature, 'confirmed');

            console.log('Liquidation successful. Signature:', signature);

            // Update the local state
            setLoans(prevLoans =>
                prevLoans.map(l =>
                    l.activeLoanPDA.equals(loan.activeLoanPDA)
                        ? { ...l, status: 'Liquidated', isLiquidated: true }
                        : l
                )
            );
        } catch (error) {
            console.error('Error liquidating loan:', error);
            setError(`Error liquidating loan: ${error.message}`);
        } finally {
            setLoading(false);
        }
    };

    const getStatusColor = (status) => {
        switch (status) {
            case 'Active':
                return 'text-green-400';
            case 'Liquidated':
                return 'text-red-400';
            case 'Repaid':
                return 'text-blue-400';
            default:
                return 'text-gray-400';
        }
    };


    const LoadingSpinner = () => (
        <div className="flex justify-center items-center h-64">
            <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-teal-500"></div>
        </div>
    );

    return (
        <main className="flex flex-col justify-center items-center py-8 sm:py-16 bg-gray-900 text-white min-h-screen">
            <section className="flex flex-col w-full max-w-6xl px-4">
                <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6 sm:mb-8">
                    <h2 className="text-2xl sm:text-4xl font-bold tracking-tight text-teal-400">
                        Loan History
                    </h2>
                    <button
                        onClick={() => router.push("/offers")}
                        className="w-full sm:w-auto px-4 sm:px-6 py-2 sm:py-3 bg-teal-500 text-gray-900 font-semibold rounded-lg hover:bg-teal-400 transition duration-300 text-sm sm:text-base"
                    >
                        VIEW AVAILABLE OFFERS
                    </button>
                </header>

                {error && (
                    <div className="bg-red-500 bg-opacity-10 border border-red-500 text-red-500 p-4 rounded-lg mb-4">
                        {error}
                    </div>
                )}

                {loading ? (
                    <LoadingSpinner />
                ) : (
                    <>
                        {/* Desktop Table View */}
                        <div className="hidden md:block bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
                            {loans.length > 0 ? (
                                <div className="flex flex-col">
                                    <div className="grid grid-cols-5 gap-4 p-4 bg-gray-750 text-sm font-medium text-teal-400 uppercase">
                                        <div>Collection</div>
                                        <div>Borrower</div>
                                        <div>Repayment Date</div>
                                        <div>Status</div>
                                        <div>Actions</div>
                                    </div>
                                    <div className="divide-y divide-gray-700">
                                        {loans.map((loan, index) => (
                                            <div key={index} className="grid grid-cols-5 gap-4 p-4 items-center">
                                                <div className="text-sm">{loan.collection.toBase58().slice(0, 6)}...</div>
                                                <div className="text-sm">{loan.borrower.toBase58().slice(0, 6)}...</div>
                                                <div className="text-sm">{new Date(loan.repayTs.toNumber() * 1000).toLocaleString()}</div>
                                                <div className={`text-sm font-semibold ${getStatusColor(loan.status)}`}>
                                                    {loan.status}
                                                </div>
                                                <div>
                                                    {loan.status === 'Active' && Date.now() > loan.repayTs.toNumber() * 1000 && (
                                                        <button
                                                            onClick={() => handleLiquidate(loan)}
                                                            className="px-4 py-2 bg-red-500 text-gray-900 text-sm rounded-full hover:bg-red-400 transition-colors duration-300"
                                                        >
                                                            Liquidate
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ) : (
                                <div className="p-8 text-center text-gray-400">
                                    No loans found
                                </div>
                            )}
                        </div>

                        {/* Mobile Card View */}
                        <div className="md:hidden space-y-4">
                            {loans.length > 0 ? (
                                loans.map((loan, index) => (
                                    <LoanCard
                                        key={index}
                                        loan={loan}
                                        onLiquidate={handleLiquidate}
                                    />
                                ))
                            ) : (
                                <div className="bg-gray-800 rounded-lg border border-gray-700 p-8 text-center">
                                    <p className="text-gray-400">No loans found</p>
                                </div>
                            )}
                        </div>
                    </>
                )}
            </section>
        </main>
    );
};

export default ActiveLoansScreen;