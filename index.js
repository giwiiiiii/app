import express from 'express';
import { Client, GatewayIntentBits, Partials, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, ChannelType, PermissionsBitField } from 'discord.js';
import dotenv from 'dotenv';
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/keepalive', (req, res) => res.send('OK'));
app.listen(PORT, () => console.log(`Keepalive running on port ${PORT}`));

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Channel],
});

const MODERATOR_ROLE_ID = process.env.MODERATOR_ROLE_ID; // 管理者ロールID
const CATEGORY_ID = process.env.PRIVATE_CATEGORY_ID;    // 作成先のカテゴリID

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on('interactionCreate', async (interaction) => {
  // 申請ボタン押下時
  if (interaction.isButton() && interaction.customId === 'open-request-modal') {
    const modal = new ModalBuilder()
      .setCustomId('channel-request-modal')
      .setTitle('プライベートチャンネル申請');

    const nameInput = new TextInputBuilder()
      .setCustomId('channel_name')
      .setLabel('チャンネル名')
      .setStyle(TextInputStyle.Short);

    const membersInput = new TextInputBuilder()
      .setCustomId('channel_members')
      .setLabel('参加メンバー（例：@userA @userB または 名前）')
      .setStyle(TextInputStyle.Paragraph);

    const row1 = new ActionRowBuilder().addComponents(nameInput);
    const row2 = new ActionRowBuilder().addComponents(membersInput);

    modal.addComponents(row1, row2);
    await interaction.showModal(modal);
  }

  // モーダル送信時
  if (interaction.isModalSubmit() && interaction.customId === 'channel-request-modal') {
    const channelName = interaction.fields.getTextInputValue('channel_name');
    const membersRaw = interaction.fields.getTextInputValue('channel_members');

    // 1. メンション形式からユーザーID抽出
    let userIds = [...membersRaw.matchAll(/<@!?(\d+)>/g)].map(m => m[1]);

    // 2. 名前で入力されたものをメンバーリストから検索
    const names = membersRaw
      .split(/\s+/)
      .filter(n => !n.match(/<@!?(\d+)>/));

    for (const name of names) {
      const member = interaction.guild.members.cache.find(
        m => m.user.username === name || m.displayName === name
      );
      if (member) {
        userIds.push(member.id);
      }
    }

    // 3. 申請者自身も追加
    userIds.push(interaction.user.id);

    // 4. 重複削除
    userIds = [...new Set(userIds)];

    const permissionOverwrites = [
      {
        id: interaction.guild.roles.everyone,
        deny: [PermissionsBitField.Flags.ViewChannel],
      },
      {
        id: MODERATOR_ROLE_ID,
        allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages],
      },
      ...userIds.map(id => ({
        id,
        allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages],
      }))
    ];

    const channel = await interaction.guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: CATEGORY_ID,
      permissionOverwrites
    });

    await interaction.reply({
      content: `✅ チャンネル <#${channel.id}> を作成しました。`,
      ephemeral: true,
    });
  }
});

// 管理者が申請ボタンを設置するコマンド
client.on('messageCreate', async (msg) => {
  if (msg.content === '!setup-button' && msg.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('open-request-modal')
        .setLabel('申請')
        .setStyle(ButtonStyle.Primary)
    );

    await msg.channel.send({
      content: 'プライベートチャンネルを申請したい場合は、以下のボタンを押してください。',
      components: [row],
    });
  }
});

client.login(process.env.DISCORD_TOKEN);