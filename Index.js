const { Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, REST, Routes } = require('discord.js');
const { Octokit } = require('@octokit/rest');
const dotenv = require('dotenv');

dotenv.config();

const config = {
    DISCORD_TOKEN: process.env.DISCORD_TOKEN,
    CLIENT_ID: process.env.CLIENT_ID,
    GUILD_ID: process.env.GUILD_ID,
    ADMIN_ROLE_ID: process.env.ADMIN_ROLE_ID,
    
    GITHUB_TOKEN: process.env.GITHUB_TOKEN,
    GITHUB_OWNER: 'ZenixWRK',
    GITHUB_REPO: 'Zenix-Plugin-Whitelists',
    WHITELIST_FILE: 'MeshLab.json',
    
    LOG_CHANNEL_ID: process.env.LOG_CHANNEL_ID
};

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const octokit = new Octokit({
    auth: config.GITHUB_TOKEN
});

let whitelistCache = null;
let lastFetch = 0;
const CACHE_DURATION = 60000;

async function fetchWhitelist() {
    const now = Date.now();
    if (whitelistCache && (now - lastFetch) < CACHE_DURATION) {
        return whitelistCache;
    }

    try {
        const { data } = await octokit.repos.getContent({
            owner: config.GITHUB_OWNER,
            repo: config.GITHUB_REPO,
            path: config.WHITELIST_FILE
        });

        const content = Buffer.from(data.content, 'base64').toString('utf-8');
        const whitelist = JSON.parse(content);
        
        whitelistCache = {
            data: whitelist,
            sha: data.sha
        };
        lastFetch = now;
        
        return whitelistCache;
    } catch (error) {
        console.error('Error fetching whitelist:', error);
        throw new Error('Failed to fetch whitelist from GitHub');
    }
}

async function updateWhitelist(newWhitelist, message) {
    try {
        const currentData = await fetchWhitelist();
        const content = JSON.stringify(newWhitelist, null, 2);
        const contentBase64 = Buffer.from(content).toString('base64');

        await octokit.repos.createOrUpdateFileContents({
            owner: config.GITHUB_OWNER,
            repo: config.GITHUB_REPO,
            path: config.WHITELIST_FILE,
            message: message,
            content: contentBase64,
            sha: currentData.sha
        });

        whitelistCache = null;
        
        return true;
    } catch (error) {
        console.error('Error updating whitelist:', error);
        throw new Error('Failed to update whitelist on GitHub');
    }
}

function isAdmin(member) {
    if (!config.ADMIN_ROLE_ID) return true;
    return member.roles.cache.has(config.ADMIN_ROLE_ID);
}

async function logAction(interaction, action, details) {
    if (!config.LOG_CHANNEL_ID) return;
    
    try {
        const logChannel = await client.channels.fetch(config.LOG_CHANNEL_ID);
        if (!logChannel) return;

        const embed = new EmbedBuilder()
            .setTitle('Whitelist Action')
            .setDescription(`**Action:** ${action}\n**By:** ${interaction.user.tag}\n**Details:** ${details}`)
            .setColor(action.includes('Added') ? 0x00ff00 : action.includes('Removed') ? 0xff0000 : 0x0099ff)
            .setTimestamp();

        await logChannel.send({ embeds: [embed] });
    } catch (error) {
        console.error('Error logging action:', error);
    }
}

const commands = [
    new SlashCommandBuilder()
        .setName('whitelist')
        .setDescription('Manage MeshLab whitelist')
        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription('Add a user to the whitelist')
                .addStringOption(option =>
                    option.setName('userid')
                        .setDescription('Roblox User ID to add')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('reason')
                        .setDescription('Reason for adding')
                        .setRequired(false)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove')
                .setDescription('Remove a user from the whitelist')
                .addStringOption(option =>
                    option.setName('userid')
                        .setDescription('Roblox User ID to remove')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('reason')
                        .setDescription('Reason for removal')
                        .setRequired(false)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('check')
                .setDescription('Check if a user is whitelisted')
                .addStringOption(option =>
                    option.setName('userid')
                        .setDescription('Roblox User ID to check')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('List all whitelisted users'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('count')
                .setDescription('Get the count of whitelisted users'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('bulk-add')
                .setDescription('Add multiple users to the whitelist')
                .addStringOption(option =>
                    option.setName('userids')
                        .setDescription('Comma-separated list of Roblox User IDs')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('reason')
                        .setDescription('Reason for adding')
                        .setRequired(false)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('bulk-remove')
                .setDescription('Remove multiple users from the whitelist')
                .addStringOption(option =>
                    option.setName('userids')
                        .setDescription('Comma-separated list of Roblox User IDs')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('reason')
                        .setDescription('Reason for removal')
                        .setRequired(false)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('clear')
                .setDescription('Clear the entire whitelist (requires confirmation)'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('backup')
                .setDescription('Get a backup of the current whitelist')),
].map(command => command.toJSON());

async function registerCommands() {
    const rest = new REST({ version: '10' }).setToken(config.DISCORD_TOKEN);

    try {
        console.log('Started refreshing application (/) commands.');

        if (config.GUILD_ID) {
            await rest.put(
                Routes.applicationGuildCommands(config.CLIENT_ID, config.GUILD_ID),
                { body: commands }
            );
        } else {
            await rest.put(
                Routes.applicationCommands(config.CLIENT_ID),
                { body: commands }
            );
        }

        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error(error);
    }
}

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'whitelist') {
        if (!isAdmin(interaction.member)) {
            return interaction.reply({
                content: '❌ You do not have permission to manage the whitelist.',
                ephemeral: true
            });
        }

        const subcommand = interaction.options.getSubcommand();

        try {
            switch (subcommand) {
                case 'add': {
                    await interaction.deferReply();
                    
                    const userId = interaction.options.getString('userid');
                    const reason = interaction.options.getString('reason') || 'No reason provided';
                    
                    if (!/^\d+$/.test(userId)) {
                        return interaction.editReply('❌ Invalid User ID. Please provide a valid Roblox User ID.');
                    }

                    const whitelist = await fetchWhitelist();
                    
                    if (whitelist.data.whitelist.includes(parseInt(userId))) {
                        return interaction.editReply(`⚠️ User ID \`${userId}\` is already whitelisted.`);
                    }

                    whitelist.data.whitelist.push(parseInt(userId));
                    await updateWhitelist(whitelist.data, `Added user ${userId} - ${reason}`);

                    await logAction(interaction, 'Added User', `User ID: ${userId}\nReason: ${reason}`);

                    const embed = new EmbedBuilder()
                        .setTitle('✅ User Added to Whitelist')
                        .setDescription(`Successfully added User ID \`${userId}\` to the MeshLab whitelist.`)
                        .addFields(
                            { name: 'User ID', value: userId, inline: true },
                            { name: 'Reason', value: reason, inline: true }
                        )
                        .setColor(0x00ff00)
                        .setTimestamp();

                    await interaction.editReply({ embeds: [embed] });
                    break;
                }

                case 'remove': {
                    await interaction.deferReply();
                    
                    const userId = interaction.options.getString('userid');
                    const reason = interaction.options.getString('reason') || 'No reason provided';
                    
                    if (!/^\d+$/.test(userId)) {
                        return interaction.editReply('❌ Invalid User ID. Please provide a valid Roblox User ID.');
                    }

                    const whitelist = await fetchWhitelist();
                    const userIdInt = parseInt(userId);
                    const index = whitelist.data.whitelist.indexOf(userIdInt);

                    if (index === -1) {
                        return interaction.editReply(`⚠️ User ID \`${userId}\` is not in the whitelist.`);
                    }

                    whitelist.data.whitelist.splice(index, 1);
                    await updateWhitelist(whitelist.data, `Removed user ${userId} - ${reason}`);

                    await logAction(interaction, 'Removed User', `User ID: ${userId}\nReason: ${reason}`);

                    const embed = new EmbedBuilder()
                        .setTitle('✅ User Removed from Whitelist')
                        .setDescription(`Successfully removed User ID \`${userId}\` from the MeshLab whitelist.`)
                        .addFields(
                            { name: 'User ID', value: userId, inline: true },
                            { name: 'Reason', value: reason, inline: true }
                        )
                        .setColor(0xff0000)
                        .setTimestamp();

                    await interaction.editReply({ embeds: [embed] });
                    break;
                }

                case 'check': {
                    await interaction.deferReply();
                    
                    const userId = interaction.options.getString('userid');
                    
                    if (!/^\d+$/.test(userId)) {
                        return interaction.editReply('❌ Invalid User ID. Please provide a valid Roblox User ID.');
                    }

                    const whitelist = await fetchWhitelist();
                    const isWhitelisted = whitelist.data.whitelist.includes(parseInt(userId));

                    const embed = new EmbedBuilder()
                        .setTitle('Whitelist Check')
                        .setDescription(`User ID \`${userId}\` is ${isWhitelisted ? '✅ whitelisted' : '❌ not whitelisted'}.`)
                        .setColor(isWhitelisted ? 0x00ff00 : 0xff0000)
                        .setTimestamp();

                    await interaction.editReply({ embeds: [embed] });
                    break;
                }

                case 'list': {
                    await interaction.deferReply();
                    
                    const whitelist = await fetchWhitelist();
                    const userIds = whitelist.data.whitelist;

                    if (userIds.length === 0) {
                        return interaction.editReply('📋 The whitelist is currently empty.');
                    }

                    const chunks = [];
                    for (let i = 0; i < userIds.length; i += 20) {
                        chunks.push(userIds.slice(i, i + 20));
                    }

                    const embeds = chunks.map((chunk, index) => {
                        return new EmbedBuilder()
                            .setTitle(`MeshLab Whitelist (Page ${index + 1}/${chunks.length})`)
                            .setDescription('```\n' + chunk.join('\n') + '\n```')
                            .setColor(0x0099ff)
                            .setFooter({ text: `Total: ${userIds.length} users` })
                            .setTimestamp();
                    });

                    await interaction.editReply({ embeds: [embeds[0]] });
                    
                    for (let i = 1; i < embeds.length; i++) {
                        await interaction.followUp({ embeds: [embeds[i]] });
                    }
                    break;
                }

                case 'count': {
                    await interaction.deferReply();
                    
                    const whitelist = await fetchWhitelist();
                    const count = whitelist.data.whitelist.length;

                    const embed = new EmbedBuilder()
                        .setTitle('Whitelist Count')
                        .setDescription(`There are currently **${count}** users whitelisted for MeshLab.`)
                        .setColor(0x0099ff)
                        .setTimestamp();

                    await interaction.editReply({ embeds: [embed] });
                    break;
                }

                case 'bulk-add': {
                    await interaction.deferReply();
                    
                    const userIds = interaction.options.getString('userids');
                    const reason = interaction.options.getString('reason') || 'Bulk add - No reason provided';
                    
                    const idsToAdd = userIds.split(',').map(id => id.trim()).filter(id => /^\d+$/.test(id)).map(id => parseInt(id));
                    
                    if (idsToAdd.length === 0) {
                        return interaction.editReply('❌ No valid User IDs provided.');
                    }

                    const whitelist = await fetchWhitelist();
                    const alreadyWhitelisted = [];
                    const newlyAdded = [];

                    for (const id of idsToAdd) {
                        if (whitelist.data.whitelist.includes(id)) {
                            alreadyWhitelisted.push(id);
                        } else {
                            whitelist.data.whitelist.push(id);
                            newlyAdded.push(id);
                        }
                    }

                    if (newlyAdded.length > 0) {
                        await updateWhitelist(whitelist.data, `Bulk added ${newlyAdded.length} users - ${reason}`);
                        await logAction(interaction, 'Bulk Added Users', `Added: ${newlyAdded.join(', ')}\nReason: ${reason}`);
                    }

                    const embed = new EmbedBuilder()
                        .setTitle('Bulk Add Results')
                        .setColor(0x00ff00)
                        .setTimestamp();

                    if (newlyAdded.length > 0) {
                        embed.addFields({ 
                            name: `✅ Added (${newlyAdded.length})`, 
                            value: newlyAdded.join(', ').substring(0, 1024) || 'None' 
                        });
                    }

                    if (alreadyWhitelisted.length > 0) {
                        embed.addFields({ 
                            name: `⚠️ Already Whitelisted (${alreadyWhitelisted.length})`, 
                            value: alreadyWhitelisted.join(', ').substring(0, 1024) || 'None' 
                        });
                    }

                    await interaction.editReply({ embeds: [embed] });
                    break;
                }

                case 'bulk-remove': {
                    await interaction.deferReply();
                    
                    const userIds = interaction.options.getString('userids');
                    const reason = interaction.options.getString('reason') || 'Bulk remove - No reason provided';
                    
                    const idsToRemove = userIds.split(',').map(id => id.trim()).filter(id => /^\d+$/.test(id)).map(id => parseInt(id));
                    
                    if (idsToRemove.length === 0) {
                        return interaction.editReply('❌ No valid User IDs provided.');
                    }

                    const whitelist = await fetchWhitelist();
                    const notInWhitelist = [];
                    const removed = [];

                    for (const id of idsToRemove) {
                        const index = whitelist.data.whitelist.indexOf(id);
                        if (index === -1) {
                            notInWhitelist.push(id);
                        } else {
                            whitelist.data.whitelist.splice(index, 1);
                            removed.push(id);
                        }
                    }

                    if (removed.length > 0) {
                        await updateWhitelist(whitelist.data, `Bulk removed ${removed.length} users - ${reason}`);
                        await logAction(interaction, 'Bulk Removed Users', `Removed: ${removed.join(', ')}\nReason: ${reason}`);
                    }

                    const embed = new EmbedBuilder()
                        .setTitle('Bulk Remove Results')
                        .setColor(0xff0000)
                        .setTimestamp();

                    if (removed.length > 0) {
                        embed.addFields({ 
                            name: `✅ Removed (${removed.length})`, 
                            value: removed.join(', ').substring(0, 1024) || 'None' 
                        });
                    }

                    if (notInWhitelist.length > 0) {
                        embed.addFields({ 
                            name: `⚠️ Not in Whitelist (${notInWhitelist.length})`, 
                            value: notInWhitelist.join(', ').substring(0, 1024) || 'None' 
                        });
                    }

                    await interaction.editReply({ embeds: [embed] });
                    break;
                }

                case 'clear': {
                    const confirmEmbed = new EmbedBuilder()
                        .setTitle('⚠️ Clear Whitelist Confirmation')
                        .setDescription('Are you sure you want to clear the entire whitelist? This action cannot be undone.')
                        .setColor(0xff0000)
                        .setTimestamp();

                    await interaction.reply({
                        embeds: [confirmEmbed],
                        content: 'Type `CONFIRM` within 30 seconds to clear the whitelist.',
                        fetchReply: true
                    });

                    const filter = m => m.author.id === interaction.user.id && m.content === 'CONFIRM';
                    const collector = interaction.channel.createMessageCollector({ filter, time: 30000, max: 1 });

                    collector.on('collect', async () => {
                        const whitelist = await fetchWhitelist();
                        const oldCount = whitelist.data.whitelist.length;
                        
                        whitelist.data.whitelist = [];
                        await updateWhitelist(whitelist.data, `Cleared whitelist - removed ${oldCount} users`);
                        await logAction(interaction, 'Cleared Whitelist', `Removed ${oldCount} users`);

                        const successEmbed = new EmbedBuilder()
                            .setTitle('✅ Whitelist Cleared')
                            .setDescription(`Successfully removed all ${oldCount} users from the whitelist.`)
                            .setColor(0x00ff00)
                            .setTimestamp();

                        await interaction.followUp({ embeds: [successEmbed] });
                    });

                    collector.on('end', collected => {
                        if (collected.size === 0) {
                            interaction.followUp('❌ Clear operation cancelled - no confirmation received.');
                        }
                    });
                    break;
                }

                case 'backup': {
                    await interaction.deferReply();
                    
                    const whitelist = await fetchWhitelist();
                    const backupData = JSON.stringify(whitelist.data, null, 2);
                    
                    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                    const filename = `meshlab-whitelist-backup-${timestamp}.json`;

                    const embed = new EmbedBuilder()
                        .setTitle('📁 Whitelist Backup')
                        .setDescription(`Here's your backup of the MeshLab whitelist containing **${whitelist.data.whitelist.length}** users.`)
                        .setColor(0x0099ff)
                        .setTimestamp();

                    await interaction.editReply({
                        embeds: [embed],
                        files: [{
                            attachment: Buffer.from(backupData),
                            name: filename
                        }]
                    });
                    break;
                }
            }
        } catch (error) {
            console.error('Command error:', error);
            
            const errorEmbed = new EmbedBuilder()
                .setTitle('❌ Error')
                .setDescription(`An error occurred: ${error.message}`)
                .setColor(0xff0000)
                .setTimestamp();

            if (interaction.deferred) {
                await interaction.editReply({ embeds: [errorEmbed] });
            } else {
                await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
            }
        }
    }
});

client.once('ready', () => {
    console.log(`✅ Logged in as ${client.user.tag}!`);
    client.user.setActivity('MeshLab Whitelist', { type: 'WATCHING' });
});

client.on('error', console.error);
process.on('unhandledRejection', console.error);

async function start() {
    await registerCommands();
    await client.login(config.DISCORD_TOKEN);
}

start();
