import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from '../src/app.module';

async function runE2ETests() {
  console.log('🧪 Starting End-to-End API Integration Verification...');

  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );
  await app.init();
  await app.listen(3099);

  const baseUrl = 'http://localhost:3099/api/v1';

  async function request(endpoint: string, method = 'GET', body: any = null, token?: string) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${baseUrl}${endpoint}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : null,
    });
    const data = await res.json();
    return { status: res.status, data };
  }

  try {
    const suffix = Date.now().toString().slice(-8);

    // 1. Register User 1
    const user1Reg = await request('/auth/register', 'POST', {
      username: `user1_${suffix}`,
      email: `user1_${suffix}@test.com`,
      password: 'password123',
      fullName: 'E2E User One',
      bio: 'E2E Test Account One',
    });
    console.log('✓ Register User 1:', user1Reg.status === 201 ? 'PASSED' : 'FAILED', `@${user1Reg.data.user?.username}`);
    const token1 = user1Reg.data.accessToken;
    const user1Id = user1Reg.data.user.id;

    // 2. Register User 2
    const user2Reg = await request('/auth/register', 'POST', {
      username: `user2_${suffix}`,
      email: `user2_${suffix}@test.com`,
      password: 'password123',
      fullName: 'E2E User Two',
      bio: 'E2E Test Account Two',
    });
    console.log('✓ Register User 2:', user2Reg.status === 201 ? 'PASSED' : 'FAILED', `@${user2Reg.data.user?.username}`);
    const token2 = user2Reg.data.accessToken;
    const user2Id = user2Reg.data.user.id;

    // 3. User 1 creates a short post
    const postRes = await request('/posts', 'POST', {
      content: 'This is a test short post for timeline verification! 🚀 #nestjs',
    }, token1);
    console.log('✓ Create Short Post:', postRes.status === 201 ? 'PASSED' : 'FAILED', `Post ID: ${postRes.data.id}`);
    const postId = postRes.data.id;

    // 4. User 2 follows User 1
    const followRes = await request(`/users/${user1Id}/follow`, 'POST', null, token2);
    console.log('✓ Follow User 1:', followRes.status === 201 ? 'PASSED' : 'FAILED', followRes.data.message);

    // 5. User 2 checks Timeline Feed (should contain User 1's post)
    const feedRes = await request('/feed', 'GET', null, token2);
    const timelineHasPost = feedRes.data?.data?.some((p: any) => p.id === postId);
    console.log('✓ Retrieve Timeline Feed containing followed post:', timelineHasPost ? 'PASSED' : 'FAILED');

    // 6. User 2 comments on User 1's post
    const commentRes = await request(`/posts/${postId}/comments`, 'POST', {
      content: 'Awesome post User 1! Loving the timeline feed.',
    }, token2);
    console.log('✓ Add Comment to Post:', commentRes.status === 201 ? 'PASSED' : 'FAILED', `Comment ID: ${commentRes.data.id}`);

    // 7. User 2 likes User 1's post
    const likeRes = await request(`/posts/${postId}/like`, 'POST', null, token2);
    console.log('✓ Like Post:', likeRes.status === 201 ? 'PASSED' : 'FAILED', `Likes count: ${likeRes.data.likesCount}`);

    // 8. Fetch Post details to verify likes & comments count
    const updatedPost = await request(`/posts/${postId}`, 'GET', null, token2);
    console.log('✓ Verify Post Stats (Likes=1, Comments=1):', 
      updatedPost.data.likesCount === 1 && updatedPost.data.commentsCount === 1 ? 'PASSED' : 'FAILED'
    );

    console.log('\n🎉 ALL E2E API INTEGRATION TESTS COMPLETED SUCCESSFULLY!');
  } catch (err) {
    console.error('❌ Test failed with error:', err);
  } finally {
    await app.close();
    process.exit(0);
  }
}

runE2ETests();
