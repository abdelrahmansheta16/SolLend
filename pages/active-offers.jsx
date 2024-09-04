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

    return (
        <main className="flex flex-col justify-center items-center py-16 max-md:py-10 bg-gray-900 text-white min-h-screen">
            <section className="flex flex-col w-[900px] max-md:w-full">
                <header className="flex justify-between items-center px-5 max-w-full font-semibold text-white w-full max-md:mx-auto mb-8">
                    <h2 className="text-4xl tracking-tighter leading-10 max-md:text-3xl max-md:leading-8">
                        Loan History
                    </h2>
                    <button
                        onClick={() => router.push("/offers")}
                        className="justify-center mx-4 px-6 py-3 bg-teal-500 shadow-xl rounded-xl flex gap-2 whitespace-nowrap text-gray-900 hover:bg-teal-400"
                    >
                        VIEW AVAILABLE OFFERS
                    </button>
                </header>
                {error && (
                    <div className="bg-red-500 text-white p-4 rounded-lg mb-4">
                        {error}
                    </div>
                )}
                {loading ? (
                    <div className="text-center text-white mb-4">Loading...</div>
                ) : (
                    <article className="flex flex-col justify-center p-6 w-full rounded-lg border border-gray-700 bg-gray-800">
                        {loans.length > 0 ? (
                            <div className="flex flex-col gap-5 max-md:gap-3">
                                <div className="flex gap-5 text-base font-bold tracking-wide leading-4 uppercase whitespace-nowrap text-teal-400 max-md:flex-wrap max-md:text-sm">
                                    <div className="flex-1">Collection</div>
                                    <div className="flex-1">Borrower</div>
                                    <div className="flex-1">Repayment Date</div>
                                    <div className="flex-1">Status</div>
                                    <div className="flex-1">Actions</div>
                                </div>
                                <div className="flex flex-col mt-6 overflow-auto max-h-[500px] max-md:max-h-[300px] max-md:mt-4">
                                    {loans.map((loan, index) => (
                                        <div key={index} className="flex gap-5 items-center py-4 border-b border-gray-700">
                                            <div className="flex-1 text-sm">{loan.collection.toBase58().slice(0, 6)}...</div>
                                            <div className="flex-1 text-sm">{loan.borrower.toBase58().slice(0, 6)}...</div>
                                            <div className="flex-1 text-sm">{new Date(loan.repayTs.toNumber() * 1000).toLocaleString()}</div>
                                            <div className={`flex-1 text-sm font-semibold ${getStatusColor(loan.status)}`}>
                                                {loan.status}
                                            </div>
                                            <div className="flex-1">
                                                {loan.status === 'Active' && Date.now() > loan.repayTs.toNumber() * 1000 && (
                                                    <button
                                                        onClick={() => handleLiquidate(loan)}
                                                        className="px-4 py-2 bg-red-500 text-gray-900 rounded-full hover:bg-red-400"
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
                            <p className='text-center text-lg max-md:text-base text-gray-400'>No loans found</p>
                        )}
                    </article>
                )}
            </section>
        </main>
    );
};

export default ActiveLoansScreen;