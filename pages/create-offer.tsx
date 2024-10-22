import React, { useState } from 'react';
import * as anchor from "@coral-xyz/anchor";
import { useWallet } from '@solana/wallet-adapter-react';
import {
    Connection,
    PublicKey,
    SystemProgram,
    Transaction,
    TransactionInstruction,
    clusterApiUrl,
} from '@solana/web3.js';
import { FiInfo, FiAlertCircle, FiCheckCircle } from 'react-icons/fi';
import BN from 'bn.js';

const PROGRAM_ID = new PublicKey('6aTvYtygQvbXrETCaRVTy2asdQzVf38msbmyPAmb62wz');
const connection = new Connection(clusterApiUrl('devnet'), 'confirmed');

const OfferLoanComponent = () => {
    const wallet = useWallet();
    const [offerAmount, setOfferAmount] = useState('');
    const [collectionId, setCollectionId] = useState('');
    const [dueDate, setDueDate] = useState('');
    const [poolName, setPoolName] = useState('');
    const [status, setStatus] = useState({ type: '', message: '' });
    const [isLoading, setIsLoading] = useState(false);

    const handleOfferLoan = async () => {
        if (!wallet.publicKey) {
            setStatus({ type: 'error', message: 'Please connect your wallet' });
            return;
        }

        if (!poolName.trim() || !collectionId.trim() || !dueDate || !offerAmount) {
            setStatus({ type: 'error', message: 'Please fill in all fields' });
            return;
        }

        setIsLoading(true);
        setStatus({ type: '', message: '' });

        try {
            const [collectionPoolKey] = PublicKey.findProgramAddressSync(
                [
                    Buffer.from('collection-pool'),
                    new PublicKey(collectionId).toBuffer(),
                    Buffer.from(poolName),
                    wallet.publicKey.toBuffer()
                ],
                PROGRAM_ID
            );

            // Check if the collection pool already exists
            const existingPool = await connection.getAccountInfo(collectionPoolKey);
            let createPoolSignature = null;

            if (!existingPool) {
                // Create Collection Pool Transaction
                const createPoolInstruction = createCollectionPoolInstruction(collectionPoolKey, collectionId, poolName, dueDate, wallet.publicKey);
                const createPoolTransaction = new Transaction().add(createPoolInstruction);

                const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
                createPoolTransaction.recentBlockhash = blockhash;
                createPoolTransaction.feePayer = wallet.publicKey;

                const signedCreatePoolTx = await wallet.signTransaction(createPoolTransaction);
                createPoolSignature = await connection.sendRawTransaction(signedCreatePoolTx.serialize());
                await connection.confirmTransaction({ signature: createPoolSignature, blockhash, lastValidBlockHeight });

                console.log('Collection pool created successfully');
            } else {
                throw new Error('Collection pool already exists. Try a different name');
            }

            // Now that we're sure the pool exists, we can create the offer
            const offerLoanInstruction = await createOfferLoanInstruction(collectionPoolKey, offerAmount, wallet.publicKey);
            const offerLoanTransaction = new Transaction().add(offerLoanInstruction);

            const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
            offerLoanTransaction.recentBlockhash = blockhash;
            offerLoanTransaction.feePayer = wallet.publicKey;

            const signedOfferLoanTx = await wallet.signTransaction(offerLoanTransaction);
            const offerLoanSignature = await connection.sendRawTransaction(signedOfferLoanTx.serialize());
            await connection.confirmTransaction({ signature: offerLoanSignature, blockhash, lastValidBlockHeight });

            setStatus({
                type: 'success',
                message: `Loan offer successful!${createPoolSignature ? ` Pool created with signature: ${createPoolSignature}.` : ''} Offer created with signature: ${offerLoanSignature}`
            });
        } catch (error) {
            console.error('Error:', error);
            setStatus({ type: 'error', message: `Error offering loan: ${error.message}` });
        } finally {
            setIsLoading(false);
        }
    };

    const createCollectionPoolInstruction = (collectionPoolKey, collectionId, poolName, dueDate, walletPublicKey) => {
        const discriminator = Buffer.from([233, 146, 209, 142, 207, 104, 64, 188]);
        const collectionIdBuffer = new PublicKey(collectionId).toBuffer();
        const poolNameBuffer = Buffer.from(poolName);
        const durationInSeconds = Math.floor((new Date(dueDate).getTime() - Date.now()) / 1000);
        const durationBuffer = new BN(durationInSeconds).toArrayLike(Buffer, 'le', 8);

        const instructionData = Buffer.concat([
            discriminator,
            collectionIdBuffer,
            new BN(poolNameBuffer.length).toArrayLike(Buffer, 'le', 4),
            poolNameBuffer,
            durationBuffer
        ]);

        return new TransactionInstruction({
            keys: [
                { pubkey: collectionPoolKey, isSigner: false, isWritable: true },
                { pubkey: walletPublicKey, isSigner: true, isWritable: true },
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            ],
            programId: PROGRAM_ID,
            data: instructionData,
        });
    };

    const createOfferLoanInstruction = async (collectionPoolKey, offerAmount, walletPublicKey) => {
        const collectionPoolAccount = await connection.getAccountInfo(collectionPoolKey);
        if (!collectionPoolAccount) {
            throw new Error('Collection pool account not found');
        }
        const accountData = collectionPoolAccount.data;
        const totalOffers = new BN(accountData.slice(8 + 32 + 32 + 8, 8 + 32 + 32 + 8 + 8), 'le');

        const [offerLoanKey] = PublicKey.findProgramAddressSync(
            [
                anchor.utils.bytes.utf8.encode("offer"),
                collectionPoolKey.toBuffer(),
                walletPublicKey.toBuffer(),
                totalOffers.toArrayLike(Buffer, 'le', 8),
            ],
            PROGRAM_ID
        );

        const [vaultAccountKey] = PublicKey.findProgramAddressSync(
            [
                anchor.utils.bytes.utf8.encode("vault"),
                collectionPoolKey.toBuffer(),
                walletPublicKey.toBuffer(),
                totalOffers.toArrayLike(Buffer, 'le', 8),
            ],
            PROGRAM_ID
        );

        const discriminator = Buffer.from([44, 12, 76, 144, 210, 208, 239, 85]);
        const offerAmountBuffer = new BN(offerAmount).toArrayLike(Buffer, 'le', 8);
        const instructionData = Buffer.concat([discriminator, offerAmountBuffer]);

        return new TransactionInstruction({
            keys: [
                { pubkey: offerLoanKey, isSigner: false, isWritable: true },
                { pubkey: vaultAccountKey, isSigner: false, isWritable: true },
                { pubkey: collectionPoolKey, isSigner: false, isWritable: true },
                { pubkey: walletPublicKey, isSigner: true, isWritable: true },
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            ],
            programId: PROGRAM_ID,
            data: instructionData,
        });
    };

    const InputField = ({ label, type, value, onChange, placeholder }) => (
        <div className="flex flex-col space-y-2">
            <label className="text-sm text-gray-300">{label}</label>
            <input
                type={type}
                value={value}
                onChange={onChange}
                placeholder={placeholder}
                className="w-full p-3 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition duration-200"
            />
        </div>
    );

    const StatusMessage = ({ type, message }) => {
        if (!message) return null;

        const statusStyles = {
            error: {
                bg: 'bg-red-500 bg-opacity-10',
                border: 'border-red-500',
                text: 'text-red-500',
                icon: <FiAlertCircle className="w-5 h-5" />,
            },
            success: {
                bg: 'bg-green-500 bg-opacity-10',
                border: 'border-green-500',
                text: 'text-green-500',
                icon: <FiCheckCircle className="w-5 h-5" />,
            },
        };

        const style = statusStyles[type] || statusStyles.error;

        return (
            <div className={`mt-4 p-4 rounded-lg ${style.bg} ${style.border} border ${style.text} flex items-start`}>
                <span className="mr-3 mt-0.5">{style.icon}</span>
                <p className="text-sm whitespace-pre-wrap">{message}</p>
            </div>
        );
    };

    return (
        <main className="flex flex-col justify-center items-center py-8 sm:py-16 bg-gray-900 text-white min-h-screen px-4">
            <section className="w-full max-w-2xl">
                <header className="flex justify-between items-center mb-6 sm:mb-8">
                    <h2 className="text-2xl sm:text-4xl font-bold tracking-tight text-teal-400">
                        Offer Loan
                    </h2>
                </header>

                <article className="flex flex-col justify-center p-4 sm:p-6 w-full rounded-lg border border-gray-700 bg-gray-800">
                    <div className="flex flex-col gap-6">
                        <div className="bg-teal-500 bg-opacity-10 border border-teal-500 rounded-lg p-4">
                            <div className="flex items-start">
                                <FiInfo className="w-5 h-5 text-teal-400 mt-0.5 mr-3" />
                                <p className="text-sm text-teal-400">
                                    Enter the collection details and loan terms below. Make sure to review all information before submitting.
                                </p>
                            </div>
                        </div>

                        <InputField
                            label="Collection ID"
                            type="text"
                            value={collectionId}
                            onChange={(e) => setCollectionId(e.target.value)}
                            placeholder="Enter collection ID"
                        />

                        <InputField
                            label="Pool Name"
                            type="text"
                            value={poolName}
                            onChange={(e) => setPoolName(e.target.value)}
                            placeholder="Enter pool name"
                        />

                        <InputField
                            label="Due Date"
                            type="date"
                            value={dueDate}
                            onChange={(e) => setDueDate(e.target.value)}
                            placeholder="Select due date"
                        />

                        <InputField
                            label="Offer Amount (in lamports)"
                            type="number"
                            value={offerAmount}
                            onChange={(e) => setOfferAmount(e.target.value)}
                            placeholder="Enter amount in lamports"
                        />

                        <button
                            onClick={handleOfferLoan}
                            disabled={isLoading}
                            className={`w-full p-3 rounded-lg font-semibold transition duration-300 flex justify-center items-center
                                ${isLoading
                                    ? 'bg-gray-500 cursor-not-allowed'
                                    : 'bg-teal-500 hover:bg-teal-400 text-gray-900'
                                }`}
                        >
                            {isLoading ? (
                                <div className="flex items-center">
                                    <svg className="animate-spin h-5 w-5 mr-3" viewBox="0 0 24 24">
                                        <circle
                                            className="opacity-25"
                                            cx="12"
                                            cy="12"
                                            r="10"
                                            stroke="currentColor"
                                            strokeWidth="4"
                                        />
                                        <path
                                            className="opacity-75"
                                            fill="currentColor"
                                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                                        />
                                    </svg>
                                    Processing...
                                </div>
                            ) : (
                                'Offer Loan'
                            )}
                        </button>

                        <StatusMessage type={status.type} message={status.message} />
                    </div>
                </article>
            </section>
        </main>
    );
};

export default OfferLoanComponent;