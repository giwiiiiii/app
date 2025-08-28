import {
  Client,
  GatewayIntentBits,
  Partials,
  ChannelType,
  PermissionsBitField,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import express from 'express';
import dotenv from 'dotenv';

dotenv.config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

// ========== Express keepalive ==========
const app = express();
app.get('/keepalive', (_, res) => res.send('ok'));
app.listen(process.env.PORT || 3000, () => console.log('Keepalive server running'));

// ========== Bot Ready ==========
client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

// ========== Interaction Handling ==========
client.on('interactionCreate', async (interaction) => {
  try {
    // ボタン: setup-button
    if (interaction.isButton() && interaction.customId === 'setup-button') {
      const modal = new ModalBuilder()
        .setCustomId('channel-request-modal')
        .setTitle('プライベートチャンネル申請');

      const nameInput = new TextInputBuilder()
        .setCustomId('channel-name')
        .setLabel('チャンネル名')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder().addComponents(nameInput));
      return interaction.showModal(modal);
    }

    // モーダル送信
    if (interaction.isModalSubmit() && interaction.customId === 'channel-request-modal') {
      await interaction.deferReply({ ephemeral: true });

      const channelName = interaction.fields.getTextInputValue('channel-name');

      const catId = process.env.PRIVATE_CATEGORY_ID?.trim();
      const modRoleId = process.env.MODERATOR_ROLE_ID?.trim();

      // ====== ID検証 ======
      if (!catId) return interaction.editReply('環境変数 PRIVATE_CATEGORY_ID が未設定です。');
      if (!modRoleId) return interaction.editReply('環境変数 MODERATOR_ROLE_ID が未設定です。');

      const cat = interaction.guild.channels.cache.get(catId);
      if (!cat || cat.type !== ChannelType.GuildCategory) {
        return interaction.editReply('PRIVATE_CATEGORY_ID がカテゴリではありません。');
      }

      const modRole = interaction.guild.roles.cache.get(modRoleId);
      if (!modRole) {
        return interaction.editReply('MODERATOR_ROLE_ID のロールが見つかりません。');
      }

      // ====== 権限設定 ======
      const permissionOverwrites = [
        { id: interaction.guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
        { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
        { id: modRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
      ];

      // ====== チャンネル作成 ======
      const channel = await interaction.guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: catId,
        permissionOverwrites,
      });

      await interaction.editReply(`✅ チャンネル <#${channel.id}> を作成しました。`);
    }
  } catch (e) {
    console.error(e);
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(`❌ エラー: ${e.message ?? e}`);
    } else {
      await interaction.reply({ content: `❌ エラー: ${e.message ?? e}`, ephemeral: true });
    }
  }
});

// ========== コマンド（初回設置用） ==========
client.on('messageCreate', async (message) => {
  if (message.content === '!setup-button') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('setup-button')
        .setLabel('チャンネル申請')
        .setStyle(ButtonStyle.Primary)
    );
    await message.channel.send({ content: 'プライベートチャンネルを申請するには下を押してください。', components: [row] });
  }
});

// ========== Login ==========
client.login(process.env.DISCORD_TOKEN);